# Review, feat/client-contacts-portal-invitations, 2026-09-13

**Reviewed by**: Claude Sonnet 5 (author on Claude Sonnet 5)
**Scope**: 65 files, branch vs main (merge base `7f3a8e5d`)
**Verdict**: Approve with nits

## Summary

This lands spec 0009 end to end: `client_contacts` gains `invited_by_user_id`, the token/limits/status pure modules are unit tested thoroughly, the acceptance door (`src/db/tenant/invitation.ts`) reads and binds a contact row from a token with no tenant context, and the five staff actions plus the accept Server Action all route through `withTenantAction()` / the scoped accessor as required. The security-critical paths — tenant scoping on every query, constant-time digest comparison, the `user_id is null` guard against concurrent binds, the digest+expiry re-check inside the same `UPDATE`'s `WHERE` clause, never logging the token/digest/email — are all correctly built and are exercised by a genuinely thorough integration suite (`contacts.db.test.ts`) that includes cross-tenant and contact-context fence tests, subscription-gate tests, and a log-line content test. I traced every acceptance criterion in spec 0009 against the code and found no correctness or security defect. The only issues worth raising are a dependency choice that deviates from what the spec named, and a small logging inconsistency.

## Minor

### 🟡 `react-email` (a CLI/dev-tooling package) added to production `dependencies` instead of the two packages the spec named, `package.json:39`
**Problem**: Spec 0009's build plan says "Install `resend`, `@react-email/components` and `@react-email/render`", but the diff installs `react-email` (v6.9.5) — the `resend/react-email` CLI package that bundles a live-preview dev server, `esbuild`, `chokidar`, `socket.io`, `commander`, etc. — into `dependencies`, not `devDependencies`. `src/email/send.ts:19` and `src/email/templates/client-invitation.tsx:1-13` import `render` and the JSX components from it. The package's own CLI (`email` bin) is never invoked anywhere in `package.json`'s scripts, so it is used purely as a re-export shim for the two packages the spec actually wanted.
**Why it matters**: This is a plain deviation from the documented decision, and it pulls a devDependency-shaped package (with its own large, unrelated dependency tree) into the runtime dependency graph. I checked `node_modules/react-email/dist/index.mjs`, the file actually imported: it only re-exports the component and `@react-email/render` modules, not the CLI code, so Vercel's import-tracing bundler likely prunes the unrelated CLI dependencies from the deployed function — the practical bundle-size risk is probably small today. But it is one more thing that can silently regress (a future import of anything else from `react-email` could pull in the CLI's dependency tree), and it means `pnpm install` and the lockfile carry a much larger package than the feature needs.
**Suggested fix**: Swap to the two packages the spec named (`@react-email/components`, `@react-email/render`), which is a drop-in replacement for the imports used here, and drop `react-email` from `dependencies` (or move it to `devDependencies` only if someone wants the local preview server later).

### 🟡 `revokeInvitation`'s no-op path writes no log line, unlike `removeContact`'s equivalent no-op, `src/contacts/revoke-invitation.ts:40-42`
**Problem**: AC-15 says "every send, send failure, revoke, remove and accept writes one structured log line". `revokeInvitation` returns early with no call to `logContactEvent` when `existing.inviteTokenHash === null` (nothing pending to revoke), so a staff member revoking an already-not-invited contact produces no audit trail entry at all. `removeContact` (`src/contacts/remove-contact.ts:27-34`), by contrast, always logs, with `outcome: "already_gone"` for its own no-op case. `contacts.db.test.ts`'s log-line test only exercises a revoke that actually clears something, so this gap is untested either way.
**Why it matters**: Minor audit-trail inconsistency: the same "nothing to do" situation is silently skipped for revoke but explicitly recorded for remove, so an operator reviewing logs cannot tell "no one tried to revoke" apart from "someone tried to revoke a contact with nothing pending" for this one operation.
**Suggested fix**: Either log a `revoke` / `no_op` (or similar) line in the early-return branch, matching `removeContact`'s pattern, or explicitly note in the module comment that a no-op revoke is deliberately silent (and adjust AC-15's wording on the next `/sync` if so).

## Nits

- ⚪ `src/contacts/contacts.db.test.ts`: the "binds once" test re-runs `acceptInvitation` sequentially for the same identity rather than truly concurrently (`Promise.all`) to exercise the `user_id is null` race guard under real contention; the guard itself is correct (verified by reading `src/db/tenant/invitation.ts:201-223`), but a `Promise.all` of two `acceptInvitation` calls with different identities against the same token would pin the actual race outcome rather than only the sequential re-visit case.

## Strengths

- The acceptance door (`src/db/tenant/invitation.ts`) re-checks the digest and expiry inside the same `UPDATE ... WHERE` that performs the bind (not just in the earlier `classify()` read), which closes a TOCTOU window a resend or expiry could otherwise open between the read and the write — a detail easy to miss and correctly handled.
- `contacts.db.test.ts` is a genuinely strong integration suite: real Postgres, rollback-per-test transactions, cross-tenant fence tests for all five staff actions, a contact-context fence test, a subscription-gate test that also proves acceptance still binds under `past_due`, and a log-line test that asserts the token, the digest and `@` never appear in any emitted line.
- The token/limits/status pure modules (`token.ts`, `limits.ts`, `status.ts`) are fully unit tested at their exact boundaries (5:00 cooldown, the 24-hour window edge, the 50th send), matching the spec's stated boundary conditions precisely.

## Test coverage

Coverage is thorough and matches the `TESTS = configured` bar well: every pure module, the email composition and rendering, the five staff actions and the acceptance door against real PostgreSQL, the UI components (including axe passes in both themes for the Contacts section and the four accept-page states), and a Playwright suite covering what is reachable with no Clerk credentials in CI. The authenticated end-to-end walk (second Clerk account accepting a real invitation) is deliberately left to the manual `verify.md` pass, which is disclosed rather than silently skipped, and the six unticked manual steps there are each cross-referenced to the automated test that covers them instead. No untested new logic of consequence was found.
