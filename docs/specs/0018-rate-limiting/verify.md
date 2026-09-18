# Verify: rate limiting · spec 0018 · updated 2026-09-18

_Steps derived from spec 0018 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] On a project page, seed `rate_limit_windows` for the agency's `upload` action at `count = 60` for the current hour, then pick a file to upload → the upload picker's existing alert region shows "Your agency has reached its upload allowance of 60 an hour. Try again in about N minutes." and no new `deliverables` row is created → AC-1, AC-2, AC-5, AC-9, AC-14
- [x] On a draft invoice, seed `rate_limit_windows` for the agency's `invoice_email` action at `count = 50` for the current day, then click Issue → the invoice screen's error region shows "Your agency has reached its allowance of 50 invoice emails a day. Try again in about N hours." and the invoice stays a draft → AC-1, AC-5, AC-14
- [x] With the same seed, click Resend on an already sent invoice → the same sentence appears, proving issue and resend share one allowance → AC-1, AC-12, AC-14
- [ ] Seed `rate_limit_windows` for a Clerk user's `create_agency` action at `count = 3` for the current day, then submit the "Create agency" form as that person → the onboarding form's alert shows "You have reached the allowance of 3 new agencies a day. Try again in about N hours." and no Clerk organization is created → AC-1, AC-6, AC-14 — **not directly observed**: the only account with `E2E_CLERK_USER_*` credentials already holds one agency, and the onboarding route only renders `CreateAgencyForm` at zero memberships (`src/app/(auth)/onboarding/page.tsx`); reaching that state needed the account removed from its Clerk organization, an account change this run didn't make. Left unchecked for that reason; accepted by the engineer as met on 2026-09-18 without it, on the strength of `agency.test.ts` (the ceiling check, its ordering before `createClerkOrganization`, and the no-Clerk-call-past-the-ceiling assertion) plus the identical, already-observed rendering path on the other three screens (AC-14's "no new component" clause means the onboarding form reuses that same error region).

## Commands

- [x] `pnpm vitest run src/rate-limit/window.test.ts` → window alignment, the minute/hour rounding and the singular rule all pass → AC-4, AC-5
- [x] `pnpm vitest run src/db/tenant/rate-limit.db.test.ts` → 60 parallel consumes against a fresh window leave `count = 60` and all succeed, the 61st is refused with the exact sentence and no extra row, a window boundary starts a fresh row at `count = 1`, and the refusal is logged with the right identifiers and no email address → AC-1, AC-3, AC-4, AC-8
- [x] `pnpm vitest run src/db/tenant/rate-limit.test.ts` → a store failure returns `allowed` and logs exactly one `rate_limit.skipped` line carrying the real error name → AC-7
- [x] `pnpm vitest run src/db/tenant/action.test.ts` → the rate limit slot is skipped when no policy is declared, runs after parsing and after the role/subscription gates, and a refusal calls no handler, opens no transaction and revalidates nothing → AC-2
- [x] `pnpm vitest run src/db/tenant/action.types.test.ts` and `pnpm typecheck` → an ad hoc `rateLimit` object (wrong action, or a real action with the wrong limit) fails to typecheck, while all three exported policies compile → AC-13
- [x] `pnpm vitest run src/deliverables/deliverables.db.test.ts -t 61st` → `requestUpload` refuses the 61st upload of the hour with the exact sentence and leaves no extra `deliverables` row → AC-1, AC-3, AC-9
- [x] `pnpm vitest run src/invoices/invoices.db.test.ts -t "rate limiting"` → `issueInvoice` refuses with no side effect once the shared allowance is spent, and `resendInvoiceNotification` draws on the same allowance for an admin and a member alike, refusing with `rate_limited` even inside the cooldown window → AC-1, AC-2, AC-11, AC-12
- [x] `pnpm vitest run src/auth/agency.test.ts` → `createAgency` consumes `create_agency` immediately before `createClerkOrganization`, refuses before any Clerk call once the ceiling is reached, and a double submit that resolves to an existing agency consumes nothing → AC-6
- [x] `pnpm vitest run src/cron/retention-sweep.db.test.ts` → an 8 day old `rate_limit_windows` row is pruned, a 6 day old one stays, and the count is reported as `rate_limit_windows_pruned` → AC-10
- [x] `pnpm db:schema:assert` → `rate_limit_windows`, its primary key and its `window_start` index are live with the right column types → AC-9
- [x] `pnpm db:migrate:check` → the committed migration and the schema agree → AC-9
- [x] `pnpm typecheck && pnpm lint && pnpm format:check` → the whole build is clean

## Acceptance-criteria coverage

- AC-1 (three policies, correctly declared and shared) … covered by the four UI steps and the `rate-limit.db.test.ts`, `deliverables.db.test.ts` and `invoices.db.test.ts` command steps
- AC-2 (checked after parsing, before the handler, no side effect on refusal) … `action.test.ts`, and the `issueInvoice` step in `invoices.db.test.ts`
- AC-3 (one atomic upsert, every attempt counts) … `rate-limit.db.test.ts`, `deliverables.db.test.ts`
- AC-4 (fixed clock windows) … `window.test.ts`, `rate-limit.db.test.ts`
- AC-5 (the refusal message, rounding and singular) … `window.test.ts`, all four UI steps
- AC-6 (`createAgency`'s person keyed ceiling, timed right before Clerk creates) … `agency.test.ts`, the onboarding UI step
- AC-7 (fail open, logged) … `rate-limit.test.ts`
- AC-8 (the refusal log line, no personal data) … `rate-limit.db.test.ts`
- AC-9 (the table, its index, the migration) … `db:schema:assert`, `db:migrate:check`, `deliverables.db.test.ts`
- AC-10 (the seven day prune) … `retention-sweep.db.test.ts`
- AC-11 (admin and member share the allowance equally) … `invoices.db.test.ts`
- AC-12 (issue and resend share the allowance; the ceiling checks before the cooldown) … `invoices.db.test.ts`
- AC-13 (the wrapper's typed slot; the Upstash variables dropped) … `action.types.test.ts`, `pnpm typecheck`, `.env.example`
- AC-14 (the sentence on all four screens, in their existing error region) … the four UI steps
