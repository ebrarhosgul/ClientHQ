# Auth

## Overview

Everything between Clerk and the local database: creating an agency, keeping the local `organizations`, `users` and `memberships` rows in step with Clerk, and the sign in, sign up and onboarding screens. Clerk owns identity and organizations. The local rows are a mirror, so the tenant layer can join a session to a local `org_id`. Settled by [spec 0005](../../docs/specs/0005-agency-sign-in-and-organization/index.md) and [spec 0015](../../docs/specs/0015-clerk-webhook-sync/index.md).

## Key files

| File | Owns |
|---|---|
| `src/auth/agency.ts` | The `createAgency` Server Action: Clerk organization first, then all three local rows in one transaction |
| `src/auth/context.ts` | `agencyContext()`, the staff context every agency page and action reads, with the mirror repaired if it is missing |
| `src/auth/clerk.ts` | The Clerk backend API narrowed to the mirror shapes. Lowercases email here, and tells a 404 apart from every other failure |
| `src/auth/webhook.ts` | The six step Clerk webhook handler, on the same shape as `src/payments/webhook.ts` |
| `src/auth/webhook-events.ts` | The Zod schemas for the event identifiers and the three re read results |
| `src/auth/webhook-log.ts` | One structured JSON line per webhook outcome that is not handled |
| `src/auth/reconcile.ts` | The `clerk_reconcile` nightly sweep: organizations, then memberships, then users |
| `src/auth/membership-analytics.ts` | What analytics hears after a membership write commits, shared by the webhook and the reconcile |
| `src/auth/slug.ts` | The agency slug, derived in one place from the name |
| `src/auth/ui/` | The sign in frame, the create agency form, the agency picker and the activation hook |
| `src/app/api/webhooks/clerk/route.ts` | The route. One of three files allowed to import `withSystemAccess` |
| `e2e/CLERK.md` | How to sign the browser suite in against a Clerk development instance |

## Conventions

- Clerk is the source of truth. A webhook event is a pointer, never state: the handler re reads the object from Clerk, outside any transaction, and the re read decides the action. Present means upsert, gone means delete. The `.created`, `.updated` and `.deleted` suffix never decides anything.
- The webhook follows the same order as the Stripe one: verify the raw body, resolve, re read, ledger insert with conflict do nothing, lock and apply, commit.
- Almost nothing answers 500, because Clerk disables an endpoint that keeps failing. 500 means only that a retry might work: a database error, a Clerk timeout or rate limit, or a payload that fails its Zod parse.
- Every write the webhook and the reconcile make goes through the same functions in `src/db/tenant/provisioning.ts`, so the two can never disagree.
- Every agency page and Server Action reads its context through `agencyContext()`, not `staffContext()`.
- `createAgency` is not a `withTenantAction`, because the caller has no organization yet. It returns the same `Result` shape and error codes, and consumes the `CREATE_AGENCY` rate limit before it calls Clerk.
- No webhook log line, report or event carries a payload, an email, a name or an image URL. Ids only.

## Gotchas

- **The repair has to live inside the cached call.** React's `cache()` memoises a rejection too, so a layout that caught `no_mirror_row` and repaired beside the call would leave every other page in that request holding the original failure.
- **Only a Clerk 404 means "gone".** Every other Clerk failure is thrown, because reading one as "the organization is deleted" would quietly log people out of healthy agencies.
- **The local slug can differ from Clerk's after a collision race.** That is fine, because no slug appears in a URL. Never copy Clerk's slug into the mirror; the repair would retry the same unique violation forever.
- **`users.email` has a CHECK that refuses uppercase.** Lowercase at the Clerk boundary in `clerk.ts`.
- **Agency creation order is fixed by the schema.** `organizations.clerk_org_id` is not null and unique, so there is no valid local row before Clerk has the organization.
- **The membership pass of the reconcile only runs for an organization this run just confirmed is live**, and nothing is removed from a listing that failed part way.
- **The reconcile never creates a `users` row from the user listing.** Only a membership listing does, as the matching webhook event would.
- **Never call a Clerk organization hook for a signed out visitor.** See the gotcha in [src/ui/AGENTS.md](../ui/AGENTS.md).
- **`setActive()` must be awaited before navigating.** It writes the session cookie in the browser, and navigating first reaches `/dashboard` with no organization claim.
- **Clerk is optional in development.** With no publishable key `src/proxy.ts` is a pass through and these screens render an unavailable state.

## Agent skills

- [clerk](../../.agents/skills/clerk/): the router for Clerk work
- [clerk-orgs](../../.agents/skills/clerk-orgs/): organizations, roles and org switching
- [clerk-webhooks](../../.agents/skills/clerk-webhooks/): verifying and handling Clerk events
- [clerk-nextjs-patterns](../../.agents/skills/clerk-nextjs-patterns/): middleware, Server Actions and caching
- [clerk-backend-api](../../.agents/skills/clerk-backend-api/): the REST API behind `clerk.ts`
- [clerk-testing](../../.agents/skills/clerk-testing/): signing the browser suite in

## Related specs

- [Spec 0005](../../docs/specs/0005-agency-sign-in-and-organization/index.md): sign in, agency creation and the mirror repair
- [Spec 0015](../../docs/specs/0015-clerk-webhook-sync/index.md): the webhook and its ledger
- [Spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md): the Clerk reconcile

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
