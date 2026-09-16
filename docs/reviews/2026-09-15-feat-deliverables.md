# Review, feat/deliverables, 2026-09-15

**Reviewed by**: opus (author on sonnet)
**Scope**: 47 files, branch vs base (`main`, merge base `dc34816`), **spec 0011 only** (deliverable upload & download) and its direct dependencies. The projects/clients feature (spec 0010) on this branch was reviewed separately in `docs/reviews/2026-09-13-feat-projects.md`; the vendored `.agents/skills/aws-sdk-js-v3-usage/**` and `.agents/skills/cloudflare-r2/**` reference material is out of scope.
**Verdict**: Changes requested

This is a **follow-up pass** after commit `64562ec fix(deliverables): stop confirm/abandon rethrowing R2 errors, close r2:setup gap`, which claimed to close the two Majors from the previous pass. Both claims were checked against current file contents, not the commit message, and every other previously flagged finding was re-checked the same way. The result is in [Previously flagged issues](#previously-flagged-issues) at the end, and repeated inline on each finding.

## Summary

`64562ec` genuinely fixes the first Major. `confirmUpload`'s out-of-rules cleanup and `abandonUpload`'s delete now each wrap `storage.delete` in `try/catch` and return `conflict`, and the client's three fire-and-forget call sites are all guarded (`safeAbandon` chains `.catch`, `runConfirm` and `beginUpload` each catch around the `await`), so a transient R2 error now lands in a phase with a visible message and a working way out instead of an unhandled rejection and a locked file input. The NUL byte in `schema.test.ts` is gone too, and that file is reviewable in a diff for the first time.

The second Major is only half fixed. `scripts/r2-setup.ts` now reads `process.env.NEXT_PUBLIC_APP_URL` instead of `env()`, so AC-19's refusal is reachable and the acceptance criterion is met — but the failure mode the previous pass was actually worried about is unchanged, because `loadEnvFiles()` populates `process.env` from `.env`/`.env.local` and `.env.example` ships `NEXT_PUBLIC_APP_URL="http://localhost:3000"` uncommented. The half of the suggested fix that would have closed it (print the bucket and the origin *before* `PutBucketCors`) was not done. Downgraded to Minor, with the residual named.

The one thing that should block merge now is that **none of the five new catch branches has a test**, in a change whose entire purpose is those branches. The fake already has `failNextDelete()`; two database cases and two component cases would prove the fix that was just written. Everything else on the previous list is unchanged: eleven findings carried forward untouched (four Minor, seven Nit), which is a lot of accumulated small debt but nothing that harms correctness.

`typecheck`, `lint` and `format:check` are clean. `pnpm vitest run src/deliverables src/storage src/lib/env.test.ts src/app/deliverables src/app/(agency)/(gated)/projects/[id]/page.test.tsx` gives 13 files / 180 tests, all passing, with the database suite actually running rather than skipped.

## Major

### 🟠 The five new catch branches are the whole point of this commit and none of them is tested, `src/deliverables/confirm-upload.ts:78`, `src/deliverables/abandon-upload.ts:47`, `src/deliverables/ui/upload-deliverable.tsx:63,134,195`

*(New this pass.)*

**Problem**: `64562ec` adds five error-handling branches — `storage.delete` failing inside `confirmUpload`'s out-of-rules cleanup, `storage.delete` failing inside `abandonUpload`, and rejections escaping `confirmUpload`, `requestUpload` and `abandonUpload` at the three client call sites. Not one of them is exercised. `deliverables.db.test.ts` gained nothing in this commit; the only test change is a one-line `beforeEach` in `upload-deliverable.test.tsx` making `mocks.abandonUpload` return a promise so `safeAbandon`'s new `.catch` has something to chain onto — a change that makes the existing tests keep passing, not one that proves the new behaviour.

**Why it matters**: The project's own bar treats untested branching error handling as a Major, and here the untested code *is* the fix: the previous pass's Major described a precise chain (R2 blip → rethrow → unhandled rejection → permanent "Finishing up…"), and nothing in the suite demonstrates that the chain is now broken. A future refactor that drops one `try/catch`, or swaps `runConfirm`'s landing phase for one without a Retry button, reintroduces the exact dead end silently. This is also unusually cheap to close: `createFakeObjectStorage` already exposes `failNextDelete()` (`src/storage/fake.ts:54`) precisely for this, and `deliverables.db.test.ts:777` already uses it for `deleteDeliverable`'s identical branch. The four cases are a copy of tests that exist.

**Suggested fix**: Two database cases — `failNextDelete()` before an out-of-rules `confirmUpload` (assert `conflict`, the row still `pending`, no throw) and before an `abandonUpload` (assert `conflict`, the row still there). Two component cases — reject `mocks.confirmUpload` and assert the `confirm-retry-exhausted` phase with a working Retry rather than a stuck "Finishing up…", and reject `mocks.requestUpload` and assert the input is enabled again with the "could not be started" message.

## Minor

### 🟡 `pnpm r2:setup`'s new refusal cannot fire for the operator it was written for, `scripts/r2-setup.ts:57`

*(Previously a Major. AC-19's letter is now satisfied; the harmful path is unchanged. **Downgraded to Minor.**)*

**Problem**: The check now reads `process.env.NEXT_PUBLIC_APP_URL` rather than `env().NEXT_PUBLIC_APP_URL`, which does make AC-19's "refuses to run without … `NEXT_PUBLIC_APP_URL`" reachable — the schema's `.default("http://localhost:3000")` no longer masks it. But `loadEnvFiles()` at line 23 runs first and copies `.env.local` and `.env` into `process.env`, and `.env.example:20` ships `NEXT_PUBLIC_APP_URL="http://localhost:3000"` uncommented, so every checkout that followed the setup instructions has it set. `verify.md`'s own bucket steps tell the operator to export only the two `R2_ADMIN_*` variables in their shell, taking everything else from that `.env`.

**Why it matters**: The scenario the previous pass described is unchanged: point `R2_BUCKET` at the production bucket from a local shell, and the script installs `http://localhost:3000` as that bucket's *only* allowed CORS origin, because `PutBucketCors` replaces the whole rule set. Every browser upload from the real origin then fails preflight and surfaces to staff as the generic "The upload did not finish." Nothing is printed before the write, so the mistake is only visible after it has been applied. The second half of the previous suggested fix is what would actually have closed this, and it was not taken.

**Suggested fix**: Print the bucket name and the origin about to be applied, and require a confirmation (or a `--yes` flag) when the origin's host is `localhost` but the bucket name is not obviously a local one. At minimum, log `Applying origin "<appUrl>" to bucket "<bucket>"` before `PutBucketCors`, so the terminal shows the mistake before the bucket does. Also add the `NEXT_PUBLIC_APP_URL`-unset case to `verify.md`'s AC-19 checklist, which currently only ticks the `R2_ADMIN_ACCESS_KEY_ID` one.

### 🟡 Both new catches swallow the R2 error entirely, and a permanent delete failure loops on misleading copy, `src/deliverables/confirm-upload.ts:78`, `src/deliverables/abandon-upload.ts:47`

*(New this pass, a consequence of the Major's fix.)*

**Problem**: Each new `catch` discards the caught value with no log line. Meanwhile `confirmUpload`'s out-of-rules cleanup failure returns `conflict`, which is the code the client's retry ladder treats as "the bytes have not landed yet": it retries three times and then shows "Your file is still being processed. Try again in a moment." with a Retry that runs the same failing delete again.

**Why it matters**: If the delete failure is permanent rather than transient — an R2 token that lost its Write scope, a bucket policy change — the row stays `pending` with an out-of-rules object behind it, the person is told indefinitely that their file is being processed, and there is nothing in the server logs to say a `DeleteObject` ever failed. The route handler's missing-object path sets the pattern for how this project logs a storage-consistency problem (`download/route.ts:114`); these two paths write nothing at all. Feature 18's sweep bounds the damage at 24 hours, but only after the operator has no signal about why.

**Suggested fix**: Log the caught error in both catches with the same JSON shape the download route uses (`event`, `deliverableId`, `orgId`, `at`, plus the error message), so feature 20 can route them to Sentry alongside the missing-object line. The returned codes can stay as they are.

### 🟡 `r2.ts` builds a new `S3Client` on every call, `src/storage/r2.ts:40`

*(Previously flagged. Still present, unchanged.)*

**Problem**: `client()` returns `new S3Client({...})` and every operation calls it — `presignPut`, `presignGet`, `head`, `remove`, one fresh client each. The docblock's stated rule is "the client is built inside a function, never at module scope", which is about not needing credentials at build time. A lazily memoised singleton satisfies that rule exactly as well, and it is already the codebase's pattern: `src/payments/stripe.ts` does `cached ??= new Stripe(...)` inside a function with a comment explaining the same reasoning, and `env()` itself does `cached ??= loadEnv()`.

**Why it matters**: `S3Client` builds a full middleware stack and a `NodeHttpHandler` whose `https.Agent` has keep-alive on by default. One per `head`/`delete` means no connection reuse across a warm Vercel function, an agent and its sockets left to the GC on every call, and a fresh middleware resolution each time. Every download does a `HeadObject` before redirecting (AC-12), so this sits on the hot path of the feature's most frequent operation.

**Suggested fix**: Memoise as `stripeClient()` does. Nothing else changes, and the no-credentials-at-build-time guarantee is unaffected.

### 🟡 The project page's contained-read-failure branch is untested, `src/app/(agency)/(gated)/projects/[id]/page.tsx:44`

*(Previously flagged. Still present, unchanged.)*

**Problem**: `loadDeliverables` has two branches in its `catch`: rethrow a `TenantResolutionError` so the layout handles it, and return `undefined` for everything else so the section renders its reload prompt instead of taking the page down. `page.test.tsx` mocks `listDeliverables` and only ever resolves it (`mockResolvedValue([])` plus per-test values); neither branch is exercised, and no test asserts the Deliverables section is on the page at all or that `storageConfigured` is wired through.

**Why it matters**: Branching error handling, which this project's test bar treats as at least a Minor. It is also a gap the codebase already knows how to close: the identical containment logic on the clients page has both tests (`src/app/(agency)/(gated)/clients/[id]/page.test.tsx:179,201`). The pattern was copied; its tests were not.

**Suggested fix**: Copy the two clients-page cases across — reject `listDeliverables` with a plain `Error` and assert the page still renders with the section's reload prompt, and reject with a `TenantResolutionError` and assert it propagates.

### 🟡 The missing-object log line still omits `org_id`, `src/app/deliverables/[id]/download/route.ts:114`

*(Previously flagged. Still present, unchanged.)*

**Problem**: Spec 0011's value-sourcing table is explicit that the AC-14 log line "carries `deliverables.id` and `org_id`". The emitted object carries `event`, `deliverableId` and `at` only.

**Why it matters**: A missing object is a storage-consistency incident, and the spec's follow-up routes this line to Sentry (feature 20). Without the tenant id, triaging "which agency is affected" needs a database lookup from a row id that may by then be gone.

**Suggested fix**: The staff branch already has the full row in hand; widen `respondWithSignedDownload`'s row parameter to include `orgId` and put it in the JSON.

### 🟡 The key rewrite's result is discarded, and the two writes are not in a transaction, `src/deliverables/request-upload.ts:65`

*(Previously flagged. Still present, unchanged.)*

**Problem**: `requestUpload` inserts with a placeholder `r2_key`, then `await db.update(deliverables, inserted.id, { r2Key })` without checking the returned row; the accessor returns `undefined` when the update matches nothing. The action also passes no `transaction`, so the insert and the rewrite are two independent statements.

**Why it matters**: The row was just inserted in the same request, so this cannot realistically fail today — but if it ever does, the row keeps `pending/<uuid>` while the browser PUTs to `org/{orgId}/project/{projectId}/{id}`. `confirmUpload` then heads the placeholder key forever (`conflict` on every retry, then "still being processed"), the uploaded bytes are referenced by nothing, and feature 18's sweep deletes the placeholder key rather than the real object — a silent, billable orphan. Cheap to close.

**Suggested fix**: Check the return and throw `not_found` (or `conflict`) when it is `undefined`, the way `confirm-upload.ts:112` and `set-deliverable-visibility.ts:36` already do. Wrapping the pair in `transaction: true` would make the two-step key write atomic as well.

### 🟡 The 302 to a credential-bearing URL sets no cache headers, `src/app/deliverables/[id]/download/route.ts:135`

*(Previously flagged. Still present, unchanged.)*

**Problem**: `Response.redirect(url, 302)` emits only `Location`. The target is a presigned R2 URL good for two minutes.

**Why it matters**: A 302 is not cacheable by default under RFC 7231, so this is defence in depth rather than a live bug — but the response is per-user and carries a credential in a header, and nothing in the route says so to any intermediary or to a future `dynamic`/`revalidate` change on this segment.

**Suggested fix**: Build the response explicitly: `new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store, private" } })`.

### 🟡 Both route pages are dead ends, and the 404 copy is duplicated by hand, `src/deliverables/download-error-page.ts:147`

*(Previously flagged. Still present, unchanged.)*

**Problem**: `notFoundResponse()` reproduces the exact heading and description of `src/app/not-found.tsx` as string literals, but drops that page's "Go to the start" action. Nothing pins the two copies together — unlike `DOWNLOAD_PAGE_TOKENS`, which *is* pinned to `globals.css` by `download-error-page.test.ts`. The 503 and missing-file pages have no way out either.

**Why it matters**: A download is a full-tab navigation, so a staff member who clicks a stale link lands on a page with no navigation, no landmark beyond `<main>`, and no way back other than the browser's back button. The copy will drift from `not-found.tsx` the first time someone edits one of them. The file's docblock correctly explains why `notFound()` cannot be used here; the duplication is the cost, and `download-error-page.test.ts` shows exactly how this project pays that kind of cost down.

**Suggested fix**: Add a link back (`/` for the 404 and 503, the referring project for the missing-file page) styled from the same inline tokens, and either export the 404 copy from one module both files import, or extend `download-error-page.test.ts` to assert the two strings still match.

### 🟡 `/design` shows approximations, not the pages the route serves, `src/app/design/gallery.tsx` (Deliverables section) / `e2e/deliverables.spec.ts:63`

*(Previously flagged. Still present, unchanged.)*

**Problem**: AC-20 requires the missing-file page and the storage-not-configured page to pass WCAG 2.2 AA in both themes and to appear on `/design`. The gallery entries for both are hand-written Tailwind re-creations (`rounded-lg border border-border bg-card`, `<p class="text-base font-semibold">` where the real page emits `<h1>`), so the axe runs at `e2e/deliverables.spec.ts:63-75` exercise markup that is never served. The same suite already navigates to the real 503 page at line 17 and asserts its status and copy — but runs no axe there.

**Why it matters**: The heading level, the `lang`, the landmark structure and the contrast of the pages that actually ship are unverified, and the gallery gives false confidence that they were checked. The token pinning in `download-error-page.test.ts` closes the *drift* half of this but measures no contrast and renders no markup.

**Suggested fix**: Run `expectNoAccessibilityViolations` on the real 503 response inside the existing test (the page is reachable signed-out with no R2 configured, which is exactly how the suite runs), and label the gallery entries as illustrations of copy rather than of the rendered page.

## Nits

- ⚪ `src/deliverables/download-error-page.ts:86`, the page keys off `prefers-color-scheme` only, so someone who has explicitly chosen the light theme in the app (the `data-theme` cookie, a three-state control per `src/ui/AGENTS.md`) gets a dark page on a dark OS.
- ⚪ `src/app/(agency)/(gated)/projects/[id]/page.tsx:56`, matches the resolution error with `error instanceof Error && error.name === "TenantResolutionError"` while the download route uses the exported `isTenantResolutionError` guard, which `src/db/tenant/errors.test.ts:114` specifically proves rejects an impostor carrying that `name`. It copies the clients page's existing pattern, but the guard is exported for exactly this and reads better.
- ⚪ `src/deliverables/ui/deliverable-visibility-switch.tsx:34`, the `<label>` wrapping a Radix Switch contributes nothing to the accessible name (HTML-AAM names a `button` from `aria-label`, then its subtree, never an ancestor `<label>`), so the visible caption is decorative. Not a defect — `button` is labelable, click forwarding works, WCAG 2.5.3 passes, and at `gap-3` the switch clears SC 2.5.8's spacing exception — but a `<span id>` plus `aria-labelledby` would say what is meant. The gallery copy at `gallery.tsx:888` would want the same edit.
- ⚪ `src/deliverables/queries.ts:33`, falls back to `uploadedBy.email` when `name` is null; the spec sources this column from `users.name` only, and this puts an email address into a list specified to show a display name.
- ⚪ `src/storage/fake.ts:52`, `deleted` is typed `readonly string[]` on the exported type but pushed to in place at line 90 — against the project's immutability rule even in a test helper. A `deletedKeys()` accessor over a private array would hold the line.
- ⚪ `eslint.config.mjs:82`, the `@aws-sdk/*` pattern does not match a deep subpath (`@aws-sdk/client-s3/dist/...`) because `*` does not cross `/` in minimatch. `@aws-sdk/*` plus `@aws-sdk/*/**` closes it.
- ⚪ `src/ui/primitives/progress.tsx:23`, `transition-surface` covers colour properties, not `transform`, so the bar jumps between progress events rather than easing. Either add an explicit transform transition or drop the class.
- ⚪ `src/deliverables/ui/upload-deliverable.tsx:37`, `CONFIRM_MAX_ATTEMPTS = 3` with `attempt < MAX` gives three confirm calls total; the spec's browser flow says "retry the confirm up to three times", i.e. four. Harmless either way, but the constant and the prose disagree.
- ⚪ `src/deliverables/ui/upload-deliverable.tsx:311`, the `confirm-retry-exhausted` phase offers a confirm retry but no "Choose another file", so a confirm that never succeeds leaves the file input disabled with no other way out. The new catch at line 134 now routes a rejected `confirmUpload` into this same phase, so it is reached by one more path than before.
- ⚪ `src/deliverables/ui/upload-deliverable.tsx:154`, the confirm-retry `setTimeout` is never cleared, so it still fires after the component unmounts.
- ⚪ `src/deliverables/download-error-page.ts:59`, `escapeHtml` handles `&`, `<`, `>` but not `"` or `'`. Safe as written (every interpolation is element text or RCDATA, and the name schema already refuses `"`), but the function reads like a general-purpose escaper and will be reused as one.
- ⚪ `src/app/deliverables/[id]/download/route.ts:108`, `NonNullable<ReturnType<typeof objectStorage>>` where `ObjectStorage` is exported from the same module; the named type reads better.
- ⚪ `docs/specs/0011-deliverable-upload-download/verify.md:35`, the commands block says "all 32 cases pass" for the database suite; it is now 38 `it()` blocks, and the in-scope unit run is 13 files / 180 tests.
- ⚪ `src/deliverables/confirm-upload.ts:67`, storage-not-configured and "the bytes have not landed yet" both surface as `conflict`, so the client's retry ladder treats a missing-credentials deployment as "Your file is still being processed."

## Strengths

- The first Major's fix is done properly and in both halves, not just the one the symptom pointed at: the two actions catch, *and* all three fire-and-forget client call sites are guarded, *and* each catch carries a comment naming `withTenantAction`'s rethrow as the reason it exists rather than restating what the code does. `safeAbandon` is the right shape — one named function that makes "best effort" explicit at each of its three call sites instead of three bare `void`s.
- `src/deliverables/deliverables.db.test.ts` remains the best test file in this change: 38 cases against real PostgreSQL in rollback transactions, covering every cross-agency and cross-client refusal individually, both `unsubscribed` and `locked` proving the gate runs *before* the row read, and both `tenantContext()` resolution failures proving they answer 404 rather than 500.
- The `runAfterNextHead` hook on the fake (`src/storage/fake.ts:58`) makes a genuine interleaving testable without a second connection or a sleep, and the two race tests it enables (`deliverables.db.test.ts:587,622`) assert the *absence* of a write and the survival of the object, not just the returned code.
- `src/deliverables/download-error-page.test.ts` is the right answer to a guard that cannot reach a file: rather than widening `token-discipline.test.ts`'s glob and inviting an exemption list, it reads the real `globals.css` through the existing `extractTokenBlock` helper and pins each pair.
- `src/lib/env.test.ts:414` pins the precise bug `isR2Configured` exists to fix — that routing the question through `env()` throws on a missing `CLERK_SECRET_KEY` and turns an intended 503 into a 500 — with a comment explaining it.
- `src/storage/r2.test.ts:52` asserts no `x-amz-checksum-*` or `x-amz-sdk-checksum-algorithm` reaches the signed URL, against the real implementation with dummy credentials. The spec warns this default arrived in a minor SDK version; this is the assertion that catches it coming back.
- Object-first removal ordering is applied consistently across all three removal paths, each with a comment tied to the invariant rather than to the code.
- The `@aws-sdk/*` boundary was implemented as plain `no-restricted-imports` with two path overrides rather than a fourth bespoke ESLint rule, exactly as the spec asked.

## Test coverage

13 files / 180 tests in scope, all passing, with the database suite running rather than skipped (`DIRECT_URL` present). Typecheck, lint and format are clean.

Covered: every AC-2 validation boundary, the allowlist and labels, `formatBytes` including the GB ceiling, the signing guarantees on the real R2 implementation, the env cross-field rule per variable, the download route's two no-database branches plus both tenant-resolution failures and both paywall levels, all five actions' happy paths and refusals against real PostgreSQL, both halves of the confirm-versus-abandon race, the full download 404 matrix for staff and contacts, and four UI components across every phase with axe in both themes.

Not covered — and the first item is the Major above: **every branch this commit added**, namely a failing `storage.delete` inside `confirmUpload`'s cleanup or `abandonUpload`, and a rejected `confirmUpload`/`requestUpload` at the client. Also still uncovered: `loadDeliverables`'s two catch branches on the project page (the sibling clients page has both); the real served HTML of the 503 and missing-file pages under axe; and four of the five actions' refusal of a contact context (only `requestUpload` is tested, though the guard is shared in `withTenantAction` so the risk is low).

## Previously flagged issues

Status of every finding from the previous pass, checked against current file contents rather than commit messages.

| # | Previous finding | Status after `64562ec` |
|---|---|---|
| 🟠 | Transient R2 error on the cleanup paths rethrows and strands the uploader | **Fixed.** `confirm-upload.ts:76-90` and `abandon-upload.ts:45-53` each catch `storage.delete` and return `conflict`; `upload-deliverable.tsx` guards all three fire-and-forget calls (`safeAbandon` at :62, `runConfirm` at :132, `beginUpload` at :188). The rejected-promise dead end is closed. **But the fix has no test** — raised as this pass's Major. |
| 🟠 | `pnpm r2:setup` cannot refuse a missing `NEXT_PUBLIC_APP_URL` | **Half fixed.** `scripts/r2-setup.ts:57` now reads `process.env` directly, so AC-19's refusal is reachable and the criterion is met. The destructive path is unchanged: `loadEnvFiles()` fills `process.env` from `.env`, which `.env.example:20` ships with `http://localhost:3000`, and no origin is printed before `PutBucketCors`. **Downgraded to Minor.** |
| 🟡 | `schema.test.ts` contains a raw NUL byte | **Fixed.** Now `String.fromCharCode(0)`; `file` reports ASCII text and the diffstat reads 113 insertions instead of `Bin`. The file is reviewable for the first time. |
| 🟡 | `r2.ts` builds a new `S3Client` on every call | Still present, unchanged. |
| 🟡 | The project page's contained-read-failure branch is untested | Still present, unchanged. |
| 🟡 | Missing-object log line omits `org_id` | Still present, unchanged. |
| 🟡 | The key rewrite's result is discarded | Still present, unchanged. |
| 🟡 | The 302 sets no cache headers | Still present, unchanged. |
| 🟡 | Route pages are dead ends; 404 copy duplicated by hand | Still present, unchanged. |
| 🟡 | `/design` shows approximations, no axe on the real pages | Still present, unchanged. |
| ⚪ | `download-error-page` keys off `prefers-color-scheme` only | Still present. |
| ⚪ | `<label>` wraps a Radix Switch | Still present. |
| ⚪ | `queries.ts` email fallback | Still present. |
| ⚪ | `fake.ts` mutable `deleted` array | Still present. |
| ⚪ | `@aws-sdk/*` misses deep subpaths | Still present. |
| ⚪ | `transition-surface` does not animate `transform` | Still present. |
| ⚪ | `CONFIRM_MAX_ATTEMPTS` disagrees with the spec prose | Still present. |
| ⚪ | `confirm-retry-exhausted` offers no "Choose another file" | Still present, and now reached by one more path (the new `runConfirm` catch lands here). |
| ⚪ | Confirm-retry `setTimeout` never cleared | Still present. |
| ⚪ | `escapeHtml` does not escape quotes | Still present. |
| ⚪ | `NonNullable<ReturnType<typeof objectStorage>>` | Still present. |
| ⚪ | `verify.md` says "32 cases" | Still present (now 38). |
| ⚪ | `confirm-upload` conflates not-configured with bytes-not-landed | Still present. |

New this pass: the Major on the untested catch branches, the Minor on those catches swallowing the error with no log line, and the nit on `error.name === "TenantResolutionError"` where the exported guard exists.
