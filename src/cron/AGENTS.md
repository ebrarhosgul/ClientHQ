# Cron

## Overview

The one daily job. Vercel Cron calls `/api/cron/daily` once a day, and the runner walks seven sweeps in a fixed order, recording each run in `cron_runs`. The run also keeps the free tier database awake. Settled by [spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md), with `analytics_erasure` added by spec 0019.

## Key files

| File | Owns |
|---|---|
| `src/app/api/cron/daily/route.ts` | The route. Checks the secret first, then hands the runner a system access handle. One of three files allowed to import `withSystemAccess` |
| `src/cron/secret.ts` | The bearer token check against `CRON_SECRET`, hashed before a constant time compare |
| `src/cron/daily.ts` | The wired list of sweeps with their live gateways |
| `src/cron/sweep.ts` | The `Sweep` type, `SWEEP_ORDER` and the report shape |
| `src/cron/runner.ts` | Inserts the run row, calls each sweep in its own `try`/`catch`, builds the report |
| `src/cron/retention-sweep.ts`, `analytics-erasure.ts` | The two sweeps that live here. The other five live beside the feature they sweep |
| `src/cron/log.ts` | One structured JSON line per sweep and one per run |
| `vercel.json` (repo root) | The schedule, `0 3 * * *` |

## Conventions

- Adding a sweep means three edits: add its name to `SWEEP_ORDER`, write the sweep beside the feature it sweeps, and wire it in `daily.ts`.
- The runner and every sweep take their database handle as an argument. Only the route imports `withSystemAccess`.
- A sweep writes every key of its counts on every run, zero when nothing happened, so a reader never guesses what a missing key means.
- The current UTC day is computed once per run and passed down. A sweep never reads the clock for the day.
- Reports, logs and the run row carry counts, durations, ids and error messages only. Never an email, a name or a row.
- Every reconcile write goes through the same functions the webhooks use. A sweep owns no write of its own.

## Gotchas

- **A sweep never stops another.** Each `run` sits in its own `try`/`catch` and the runner never rethrows, so one failing sweep is a `failed` report entry and the rest still run.
- **Sweeps are idempotent instead of locked.** The overdue write is a compare and set on `status = 'sent'`, and deletes tolerate a missing row or object. That is why no overlap lock exists.
- **Remove the object first, then the row.** A row is never deleted while its object might still exist.
- **Nothing is deleted or scrubbed from an incomplete provider listing.**
- **`deleted_at` only moves from null to set.** The reconciles never revive a row.
- **The Hobby plan allows two cron slots**, which is why everything shares one route.

## Related specs

- [Spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md): the runner, the sweeps and their invariants
- [Spec 0019](../../docs/specs/0019-product-analytics-and-error-tracking/index.md): `analytics_erasure` and the failed sweep signal

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
