# Verify: daily cron sweeps · spec 0017 · updated 2026-09-18

_Scoped to the two deployment walks the Build plan's milestone 5 asks for: a manual `curl` against the deployed route, and one real scheduled run. The exhaustive acceptance-criteria checklist (UI/manual and Commands, on the shape of the other specs' `verify.md` files) is `/check verify daily cron sweeps`'s job and has not run yet._

## Deploy

- [x] `feat/daily-cron-sweeps` merged to `main` via [PR #44](https://github.com/ebrarhosgul/ClientHQ/pull/44), all CI checks green (lint, typecheck, unit + db tests, migration drift, a fresh-Postgres migration apply, Playwright)
- [x] `.github/workflows/migrate.yml` ran on the merge: applied the `cron_runs` migration to the deployed database, then called the Vercel deploy hook → both jobs succeeded
- [x] `CRON_SECRET` was missing from the Vercel project's Production environment (this is the first feature to need it) → generated with `openssl rand -hex 32` and added via `vercel env add CRON_SECRET production`, then a fresh `vercel deploy --prod` so the running deployment actually picked it up (the deployment `migrate.yml` had already triggered predates the env var)

## Manual `curl`

- [x] `curl -i https://client-hq-ebrar.vercel.app/api/cron/daily` (no header) → **401**, body `{}` → AC-1
- [x] `curl -i https://client-hq-ebrar.vercel.app/api/cron/daily -H "Authorization: Bearer $CRON_SECRET"` → **200**, `outcome: "ok"`, all six sweeps present in `SWEEP_ORDER` → AC-2, AC-3

  ```json
  {"runId":"01a0b3a7-d6e2-71b3-a089-8b7479a0fcec","outcome":"ok","sweeps":[
    {"name":"overdue_invoices","outcome":"ok","counts":{"moved":0}},
    {"name":"abandoned_uploads","outcome":"ok","counts":{"removed":1,"failed":0,"truncated":false}},
    {"name":"expired_invites","outcome":"ok","counts":{"cleared":0}},
    {"name":"stripe_reconcile","outcome":"ok","counts":{"listed":2,"applied":0,"unresolved":0,"customer_conflict":1,"superseded":1,"unlisted":4,"errors":0}},
    {"name":"clerk_reconcile","outcome":"ok","counts":{"organizations_upserted":2,"organizations_soft_deleted":4,"skipped_deleted":0,"memberships_upserted":2,"memberships_removed":0,"skipped_scrubbed":0,"users_updated":3,"users_scrubbed":30,"listing_incomplete":false,"errors":0}},
    {"name":"retention_prune","outcome":"ok","counts":{"webhook_events_pruned":0,"cron_runs_pruned":0}}
  ]}
  ```

- [x] The `cron_runs` row for that `runId` has `started_at`, a later `finished_at`, and `outcome: "ok"` → AC-2

**Not a bug, worth recording:** this was the first `clerk_reconcile` run against the real Clerk account for this project, and the local mirror held rows Clerk has never heard of: the three `pnpm db:seed` demo agencies (Anchor Ridge, Harbor Lane, Studio North) and their seed users, plus roughly two dozen leftover organizations and users from this session's own test-fixture churn (webhook tests inserting rows directly rather than through Clerk). None of those had a real Clerk-side object, so the reconcile correctly soft-deleted the four organizations and scrubbed the thirty users — that's AC-8 working as designed, not a defect. The practical effect: the seed demo data is gone from this database until `pnpm db:seed` runs again, and seed data will need to either be created through Clerk itself or excluded from what the reconcile can see, the next time someone relies on it for a walkthrough.

## Scheduled run

- [x] `vercel.json` ships `crons: [{ path: "/api/cron/daily", schedule: "0 3 * * *" }]`, deployed to Production as of this walk
- [ ] **Not yet observed.** Vercel Cron only fires on Production deployments, at 03:00 UTC; this deploy landed at 08:35 UTC on 2026-09-18, so the first scheduled firing is expected around 03:00 UTC on 2026-09-19. Confirm by querying `cron_runs` for a row with `started_at` in that window that was **not** triggered by a manual `curl` — a distinct `runId` from the one above, and no corresponding local `curl` at that timestamp.

## Acceptance-criteria coverage (this walk only)

- AC-1, AC-2, AC-3 · the two `curl` calls above, against the deployed route
- AC-8 · the `clerk_reconcile` counts above, against the real Clerk account
- AC-11 · the deployed `vercel.json` `crons` entry; the route answered as `runtime = "nodejs"` would
- AC-12 · not covered here; covered by `src/cron/overlap.db.test.ts`, not by this deploy walk

Everything else (AC-4 through AC-7, AC-9, AC-10 in production, the full UI/manual pass, the scheduled run above) is `/check verify daily cron sweeps`'s job.
