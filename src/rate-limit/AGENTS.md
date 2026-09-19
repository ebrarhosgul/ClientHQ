# Rate limit

## Overview

The three named ceilings that protect actions costing real money or provider quota: uploads, invoice emails and agency creation. This folder holds the pure parts: the policies, the window arithmetic and the log lines. The counter itself lives in the tenant layer. Settled by [spec 0018](../../docs/specs/0018-rate-limiting/index.md).

## Key files

| File | Owns |
|---|---|
| `src/rate-limit/policies.ts` | `UPLOAD`, `INVOICE_EMAIL` and `CREATE_AGENCY`, and `RateLimitPolicy`, the union of exactly those three |
| `src/rate-limit/window.ts` | The clock aligned window, the retry time and the refusal sentence. Pure |
| `src/rate-limit/log.ts` | `rate_limit.refused` and `rate_limit.skipped` lines |
| `src/db/tenant/rate-limit.ts` (outside this area) | The door: one atomic upsert per attempt, and the only code that touches `rate_limit_windows` |

## Conventions

- Opting an action in is one line: `rateLimit: UPLOAD` on its `withTenantAction` config. The wrapper checks after the input parses and before the handler, never inside the action's transaction.
- A fourth policy needs no migration. Add a constant here and extend the `RateLimitPolicy` union, so a hand written object is still a type error.
- Nothing here imports server code. The wrapper's config type imports this folder and the wrapper is imported from client components.
- Every attempt that reaches the check consumes one unit, whether it is then allowed, refused or fails later.
- Log lines carry ids, counts and windows only. Never a name, an email or an input field.

## Gotchas

- **It fails open.** If the counter statement throws, the action goes ahead and one `rate_limit.skipped` line records it. There is no fail closed mode and no switch to turn the limiter off.
- **Windows align to the Unix epoch.** That reads as the UTC clock only because 3600 and 86400 divide it evenly. A policy with a window like 2700 seconds would no longer reset on the hour.
- **A burst across a window boundary can reach double the ceiling.** Spec 0018 accepts that.
- **Refusal wording is fixed by spec 0018.** Minutes under an hour, otherwise hours, rounded up, so 3599 seconds reads "in about 1 hour".
- **The role and subscription gates run before the limiter**, so a signed out or locked caller never learns a ceiling exists.
- **The `retention_prune` sweep deletes counter rows older than seven days.**
- **Invitations use their own limits**, not this table. See [src/contacts/AGENTS.md](../contacts/AGENTS.md).
- Spec 0001 planned Upstash Redis for this. Spec 0018 retired it, and there is no Upstash code.

## Related specs

- [Spec 0018](../../docs/specs/0018-rate-limiting/index.md): the policies, the door and the messages
- [Spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md): the prune

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
