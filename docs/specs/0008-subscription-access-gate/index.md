# 0008. Subscription access gate

**Date**: 2026-09-11
**Status**: In Progress

## Summary

This settles what an agency may do in the product depending on whether it is paying. The gate turns the `subscriptions` row that the Stripe webhook keeps up to date (spec 0007) into one of four access levels: Unsubscribed, Full, Grace (a 7 day read only window after a failed payment) and Locked. The level is worked out fresh on every request from two columns and the clock, so nothing stores it, no job expires it, and no data is ever deleted. It runs in two server side places: a layout that sends a locked or unsubscribed agency to `/billing`, and the `withTenantAction()` wrapper that refuses every write unless the agency has full access. The only actions exempt are the two that let an agency pay.

## Requirements

**User stories**:
- As an agency admin whose payment failed, I want a week to fix my card while still being able to read everything, so that one declined charge does not stop my work.
- As an agency member, I want to see plainly why changes are paused and who can fix it, so that I do not keep retrying a form that will never save.
- As an agency admin whose subscription has lapsed, I want to still reach billing and account settings, so that I can subscribe again and pick up exactly where I left off.
- As the operator, I want every write in the product refused by construction when an agency is not paid up, so that a new screen is safe by being new rather than by someone remembering a check.
- As the operator, I want the gate to read the local row only, never Stripe, so that a Stripe outage cannot take the whole product down.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: The access level is a pure function of exactly three inputs, the row's `status`, the row's `past_due_since` and the current time, returning one of `unsubscribed`, `full`, `grace` or `locked`. The mapping is: no row or `incomplete` gives `unsubscribed`; `trialing` or `active` gives `full`; `past_due` with `past_due_since` less than 7 days ago gives `grace`; `past_due` 7 days or more ago gives `locked`; `unpaid`, `canceled`, `incomplete_expired` and `paused` give `locked`; any status not in that list gives `locked`. `cancel_at_period_end` does not affect the level.
- **AC-2**: The grace window is 7 days measured from `past_due_since` against the current time at the moment of the read. It expires on its own: with no scheduled job and no write, a request made 7 days after `past_due_since` sees `locked` where a request made a minute earlier saw `grace`.
- **AC-3**: A `past_due` row whose `past_due_since` is null is treated as `locked`, never as an open ended grace window. The pure function reports it as `invariantBreak: "past_due_without_since"`, and both callers (`agencyAccess()` and `requireFullAccess()`) log it through `logGateInvariant` with the organization id, one line per request.
- **AC-4**: When the level is `unsubscribed` or `locked`, a server render of any agency page other than `/billing` and `/settings` redirects to `/billing`. `/billing` and `/settings` render at every level, so the redirect can never loop.
- **AC-5**: When the level is `grace`, every agency page renders normally for reads, with one persistent banner above the page content. The banner says the last payment failed, that changes are paused until a named date and time in UTC (7 days after `past_due_since`), and how to fix it. An admin gets a button that opens the Billing Portal; a member gets the sentence that only an admin can update the card, and a link to `/billing`. The banner appears in no other level.
- **AC-6**: `withTenantAction()` refuses the write with `{ ok: false, error: { code: "subscription_inactive" } }` whenever the level is not `full`, after the role guard and before the input is parsed, on the pooled executor and outside any transaction (the wrapper opens its transaction later, around the handler only), unless the action's config sets `subscription: "any"`. `startCheckout` and `openBillingPortal` are the only actions that set it. `setThemeAction` and `createAgency` are outside the wrapper and unaffected.
- **AC-7**: `subscription_inactive` is added to `ACTION_ERROR_CODES` in `src/db/tenant/errors.ts`. The union stays exhaustively switchable, and every existing switch over it compiles only once it handles the new code. A form that receives it shows the refusal message with a link to `/billing`.
- **AC-8**: No code path in the gate inserts, updates or deletes any row. The `subscriptions` row is still written only by the Stripe webhook route, and the gate makes no call to Stripe.
- **AC-9**: The gate reads the row through the tenant scoping layer with the organization taken from the resolved context, selecting only `status` and `past_due_since`, once per request (React `cache()`), with no cross request cache.
- **AC-10**: `/billing` shows a plain notice at the top when the level is `locked`, saying access is paused and nothing has been deleted. For an admin it says that subscribing again or updating the card restores access; for a member it says that only an admin of the agency can do that. The notice is derived from the level and the session role, not from anything in the URL.
- **AC-11**: Every refusal by the wrapper is logged through `logRefusal` with the reason `subscription_inactive:<level>`, the user id and the organization id. The normal path (level `full`) logs nothing.
- **AC-12**: If the subscription read throws (the database is unreachable), the error propagates and no page renders and no write runs. On the page side it is caught by a new `src/app/(agency)/error.tsx` boundary, which sits above the gated layout and renders inside the shell; on the write side the wrapper rethrows rather than returning a Result. The gate never fails open.
- **AC-13**: With no Clerk publishable key configured, the gated layout returns its children before calling `agencyAccess()`, guarded by the same `isClerkConfigured()` check the agency layout uses today, so the browser suite in CI still renders every page.
- **AC-14**: The banner and the billing notice meet WCAG 2.2 AA in both themes: each is a landmark with an accessible name, the meaning does not rest on colour alone, every colour is a token pair from `globals.css`, the action is reachable by keyboard, and axe passes on the rendered states.

## Decision

**Chosen option**: Option 1: Derive the level at read time, and enforce it in a gated route group layout plus the action wrapper.

The level is computed by one pure function in `src/access/level.ts`, applied to pages by a new nested route group `src/app/(agency)/(gated)/` whose layout redirects or renders the banner, and applied to writes inside `withTenantAction()` by a guard that runs after the role check and refuses with the new `subscription_inactive` code. `/billing` and `/settings` stay outside the gated group. The two billing actions opt out with `subscription: "any"`. Nothing new is stored, no environment variable is added, and Stripe is never called on a gate path.

**Implementation skills**: `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `typescript-core` (`.agents/skills/typescript-core/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

No table or column changes. The gate reads, and only reads:

| Table | Columns read | Written by |
|---|---|---|
| `subscriptions` | `org_id` (uuid, not null, unique, the tenant predicate), `status` (text, not null, no CHECK, mirrors Stripe), `past_due_since` (timestamptz, nullable, set on the database clock by the webhook) | The Stripe webhook route only (spec 0007) |

The level is never stored. It is the value of `accessLevel(row, now)` at the instant of the read.

**State transitions**:

The four levels are not a state machine the app drives; they are a view over Stripe's status plus time. Written out so `/develop` and `/check verify` have the full table:

```
row                                    now                                   level
─────────────────────────────────────  ────────────────────────────────────  ────────────
no row                                 any                                   unsubscribed
status = incomplete                    any                                   unsubscribed
status = trialing | active             any                                   full
status = past_due, since set           now <  since + 7 days                 grace
status = past_due, since set           now >= since + 7 days                 locked
status = past_due, since null          any  (logged as an invariant break)   locked
status = unpaid | canceled |
         incomplete_expired | paused   any                                   locked
status = anything else                 any                                   locked
```

Transitions between levels happen only because the webhook changes the row (spec 0007) or because time passes. `grace` becomes `locked` with no write. A return to `active` clears `past_due_since` (spec 0007, AC-12), which is what makes a later failure open a fresh 7 day window rather than inherit a stale one.

**Module layout** (where each piece lives, so the dependency direction stays one way):

| File | Holds | Imports from |
|---|---|---|
| `src/payments/subscription-status.ts` | `SUBSCRIPTION_STATUSES`, `SubscriptionStatus`, `isKnownStatus`, moved out of `billing-state.ts` so the gate can share the vocabulary without importing UI types | nothing |
| `src/access/level.ts` | `ACCESS_LEVELS`, `AccessLevel`, `GRACE_WINDOW_DAYS = 7`, `graceEndsAt(pastDueSince)`, `accessVerdict(row, now)` returning `{ level, graceEndsAt?, invariantBreak? }` (pure, exhaustive switch over `SubscriptionStatus`, default `locked`), and `accessLevel(row, now)` as the one field shorthand | `src/payments/subscription-status.ts`, the row type from `src/db/schema` |
| `src/access/gate.ts` | `agencyAccess()`: React `cache()` wrapped read of the agency's row through `tenantDb(ctx)`, returning `{ level, graceEndsAt?, role }` | `src/auth/context.ts`, `src/db/tenant`, `src/access/level.ts` |
| `src/db/tenant/subscription.ts` | `requireFullAccess(ctx)`: the write side guard the wrapper calls. Reads the row with the staff accessor on the pooled executor (no transaction is open yet), takes the verdict, logs an `invariantBreak` through `logGateInvariant`, and throws `tenantActionError({ code: "subscription_inactive" })` on anything but `full` | `./accessor`, `./errors`, `./log`, `src/access/level.ts` |
| `src/db/tenant/log.ts` | Gains `logGateInvariant({ orgId, reason })`, emitting the event `access.invariant` on the same structured emitter as the refusal log | unchanged |
| `src/db/tenant/action.ts` | The reserved `subscription?: never` slot becomes `subscription?: "any"`; the guard runs after the role guard and before parsing unless the option is set | `./subscription` |
| `src/app/(agency)/(gated)/layout.tsx` | Returns `children` untouched when `isClerkConfigured()` is false; otherwise calls `agencyAccess()`, redirects to `/billing` on `unsubscribed` or `locked`, and renders `<GraceBanner>` above `children` on `grace` | `src/lib/env.ts`, `src/access/gate.ts`, `src/access/ui/grace-banner.tsx` |
| `src/app/(agency)/error.tsx` | New error boundary from the spec 0004 error state pattern. Sits above the gated layout, so a throw from the gate read lands here and renders inside the shell. `/billing` and `/clients/[id]` keep their own boundaries | `src/ui/patterns` |
| `src/access/ui/grace-banner.tsx` | The banner, admin and member variants | `src/payments/ui/billing-actions.tsx` (the existing portal button), design system primitives |
| `src/access/ui/locked-notice.tsx` | The notice `/billing` renders on `locked`, with an admin and a member variant | design system primitives |

`src/access/level.ts` imports nothing from `src/db/tenant`, which is what keeps `src/db/tenant/action.ts` importing it without a cycle. `src/access/gate.ts` does import the tenant layer, and nothing in the tenant layer imports it back.

**Route structure**:

```
src/app/(agency)/
  layout.tsx            unchanged: resolves agencyContext(), renders AppShell
  not-found.tsx         unchanged
  billing/              stays here: reachable at every level
  settings/             stays here: reachable at every level
  (gated)/
    layout.tsx          new: the gate (redirect, or banner)
    dashboard/          moved in, path unchanged
    clients/            moved in, path unchanged
    projects/           moved in, path unchanged
    invoices/           moved in, path unchanged
    team/               moved in, path unchanged
```

Route groups add no URL segment, so `src/proxy.ts`, `src/ui/shell/navigation.ts` and every link stay exactly as they are. A page added under `(gated)` later is gated by being there; a page that must stay reachable while lapsed is a deliberate move out of the group, visible in the diff.

**API surface**:

No new route handlers. The surface is one pure function, one read, one wrapper option, one layout and two components.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `accessVerdict(row, now)` | pure function, `src/access/level.ts` | `row: { status: string; pastDueSince: Date \| null } \| undefined`, `now: Date` | `{ level: AccessLevel, graceEndsAt?: Date, invariantBreak?: "past_due_without_since" }` | none, pure | none; unknown status maps to `locked`; it never throws and never logs |
| `accessLevel(row, now)` | pure function | the same | `AccessLevel` only | none, pure | none |
| `graceEndsAt(pastDueSince)` | pure function | `Date` | `Date` (`pastDueSince` + 7 days) | none | none |
| `agencyAccess()` | cached server read, `src/access/gate.ts` | none (context from `agencyContext()`) | `{ level, graceEndsAt?: Date, role }` | signed in staff, resolved context | resolution errors propagate as today; a database error propagates |
| `requireFullAccess(ctx)` | guard, `src/db/tenant/subscription.ts` | `StaffContext` | `void`, or throws | called by the wrapper only, before parsing and outside any transaction | throws `tenantActionError` with `subscription_inactive`; a database error propagates |
| `logGateInvariant({ orgId, reason })` | log emitter, `src/db/tenant/log.ts` | `orgId: string`, `reason: "past_due_without_since"` | one structured line, event `access.invariant` | internal | none |
| `withTenantAction({ subscription?: "any" })` | wrapper option | `"any"` to skip the guard; unset means `full` is required | unchanged `Result<T>` | as today | new code `subscription_inactive`, message safe to show |
| `(gated)/layout.tsx` | layout | `children` | redirect to `/billing`, or banner plus children | staff session (the proxy and the parent layout guarantee it) | none of its own |
| `GraceBanner` | component | `graceEndsAt: Date`, `role: "admin" \| "member"` | region landmark | rendered only on `grace` | none |
| `LockedNotice` | component | `role: "admin" \| "member"` | region landmark on `/billing` | rendered only on `locked` | none |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `accessLevel` | the Stripe status | `subscriptions.status`, written by the webhook from `subscriptions.retrieve` (spec 0007) |
| `accessLevel` | when the failure started | `subscriptions.past_due_since`, set once on the database clock (spec 0007, AC-12) |
| `accessLevel` | the current time | `new Date()` at the read, passed in as `now` so tests control it; a few seconds of skew between a serverless clock and the database clock is nothing against a 7 day window |
| `accessLevel` | the window length | `GRACE_WINDOW_DAYS = 7` in `src/access/level.ts`, a constant and not an environment variable, because it is a product rule and not deployment configuration |
| `accessLevel` | which statuses are known | `SUBSCRIPTION_STATUSES` in `src/payments/subscription-status.ts`, exhaustive over the pinned Stripe SDK's union |
| `agencyAccess` | which organization | `ctx.orgId` from `agencyContext()`, itself from the Clerk session (spec 0003); never a URL or form value |
| `agencyAccess` | whether to show the portal button | `ctx.role` from the Clerk session claim, never `memberships.role` (spec 0003, AC-11) |
| `GraceBanner` | "changes are paused until …" | `graceEndsAt(past_due_since)` formatted by `formatBillingDate` from `src/payments/billing-state.ts`, so it reads in UTC and says so, like the billing page |
| `GraceBanner` | the Billing Portal | the existing `openBillingPortal` action through `src/payments/ui/billing-actions.tsx` (spec 0007, AC-6), admin only |
| `(gated)/layout` | where to send a locked agency | the literal `/billing`, fixed by `src/ui/shell/navigation.ts` |
| `requireFullAccess` | the row it judges | `tenantDb(ctx).findFirst(subscriptions)` on the pooled executor, before parsing and before any transaction opens; the wrapper's transaction wraps the handler only, and the webhook can change the row between the guard and the handler either way, so no lock is taken |
| `agencyAccess`, `requireFullAccess` | the invariant break to log | `invariantBreak` on the verdict, logged through `logGateInvariant` with `ctx.orgId`; one line per request and no dedupe, because the state is a webhook bug and loud is right |
| `LockedNotice` | who can fix it | `ctx.role` from the session claim: an admin reads "subscribe again or update the card", a member reads "only an admin of this agency can do that" |
| `(gated)/layout` | whether to run the gate at all | `isClerkConfigured()` from `src/lib/env.ts`, the same check the agency layout makes |
| wrapper refusal | the message a person sees | one fixed sentence in `src/db/tenant/subscription.ts`: "Your agency's subscription needs attention before changes can be saved. Open Billing to sort it out." Never a Stripe status name |
| `LockedNotice` | that nothing was deleted | a true statement by construction (AC-8), fixed wording |
| `/billing` | whether to render the notice | `agencyAccess().level === "locked"`; `unsubscribed` needs nothing extra, the existing "No subscription" card already explains it |

**Key invariants**:
- The level is derived, never stored. There is no column, cookie, session claim or cache entry that holds it across requests.
- Every write through `withTenantAction()` requires `full` unless the config says `subscription: "any"`, and only `startCheckout` and `openBillingPortal` say it. A test in `src/payments/fence.test.ts` (extending the existing fence test) pins that list.
- The gate never writes and never calls Stripe. `src/access/` imports nothing from `src/payments/stripe.ts` or `src/payments/gateway.ts`.
- An unknown status is `locked`. The switch in `accessLevel` is exhaustive over `SubscriptionStatus`, with the non exhaustive `string` handled first by `isKnownStatus`, so a status Stripe invents tomorrow is recorded by the webhook (spec 0002) and locks here, which fails in the safe direction.
- `/billing` and `/settings` are never behind the gate. Moving either into `(gated)` would make a lapsed agency unable to pay; the layout test asserts both paths render on `locked`.
- The grace window end is `past_due_since + 7 days` and the comparison is `now < end` for `grace`. At exactly the boundary the level is `locked`.
- Reads in `grace` are untouched. The gate adds no predicate and no filter to any query; the accessor is exactly as scoped as before.

**Security model**:
- Both staff roles are gated identically for reads and writes; the role changes only what the banner offers (admin: portal button; member: the sentence and a link).
- The two exempt actions keep their own `requireRole: "admin"` (spec 0007, AC-13). Opting out of the subscription gate does not relax the role gate.
- The level is decided server side in every case. The proxy still decides only "signed in" and "has an organization" (spec 0001), because it cannot reach the database from the edge.
- A client contact is never gated by this feature today, because the client portal is not built. The rule this spec fixes for feature 15: a contact of an agency whose level is `locked` sees a plain unavailable page naming the agency; `grace` and `full` leave the portal readable, since a contact only ever reads. The pure function is shared; the read for a contact context goes through `unsafeTenantQuery` with the reason `portal gate`, because spec 0003 keeps `subscriptions` out of the contact accessor on purpose and this is the one narrow exception, selecting `status` and `past_due_since` and nothing else.
- Webhooks and the cron route run under `withSystemAccess` and are not gated; the gate would otherwise stop the very event that restores access.
- Compliance scope: none new. No card data, no personal data beyond what spec 0007 already handles. The refusal log carries ids only.

**Configuration required**: none. No new environment variable, secret or third party setup. The 7 day window is a named constant.

**Critical test scenarios**:
- Happy path: a new agency finishes onboarding, is sent from `/dashboard` to `/billing`, subscribes through Checkout, and on the next load of `/dashboard` the page renders with no banner, verifies **AC-1**, **AC-4**.
- Grace, reads and writes: with `status = past_due` and `past_due_since` an hour ago, `/clients` renders the list with the banner, and `createClient` returns `subscription_inactive` and inserts nothing, verifies **AC-5**, **AC-6**, **AC-8**.
- Lapse without a job: the same row with `past_due_since` 7 days and one second ago; `accessLevel` returns `locked`, `/clients` redirects to `/billing`, and `/billing` shows the notice, all with no write and no scheduled job, verifies **AC-2**, **AC-4**, **AC-10**.
- Boundary: `past_due_since` exactly 7 days ago returns `locked`; one millisecond less returns `grace`, verifies **AC-2**.
- Invariant break: `status = past_due` with `past_due_since = null` returns `locked` with `invariantBreak` set, and both `agencyAccess()` and `requireFullAccess()` emit one `access.invariant` line carrying the organization id, verifies **AC-3**.
- Unknown status: `status = "something_new"` returns `locked`, verifies **AC-1**.
- Exemption: with a `locked` row, `openBillingPortal` as an admin still reaches its handler, and as a member still returns `forbidden`, verifies **AC-6**.
- Order of checks: a member with a `locked` row calling an admin only action gets `forbidden`, not `subscription_inactive`; a locked admin sending invalid input gets `subscription_inactive`, not `validation`, verifies **AC-6**.
- Reachable pages: `/billing` and `/settings` render on `locked` and on `unsubscribed`, verifies **AC-4**.
- Auth/permission: the banner for a member has no portal button and carries the "only an admin" sentence, verifies **AC-5**.
- Failure case: the subscription read rejects; the gated layout throws and `src/app/(agency)/error.tsx` renders inside the shell, and the wrapper rethrows rather than returning `ok`, verifies **AC-12**.
- Compiler: adding `subscription_inactive` to the union without updating `client-form.tsx` fails `pnpm typecheck`, verifies **AC-7**.
- Pass through: with no Clerk key, `/dashboard` renders in the browser suite exactly as it does today, verifies **AC-13**.
- Accessibility: axe on the banner (both variants) and the notice in both themes, plus a keyboard walk to the portal button, verifies **AC-14**.

## Build plan

Tracer Bullet: the first task stands the whole pipe up thin, from a row to a redirect and a refused write, proven on a real subscribe. Then the grace window is thickened, then the edges and the polish.

1. [x] **One thread end to end.** Move `SUBSCRIPTION_STATUSES`, `SubscriptionStatus` and `isKnownStatus` into `src/payments/subscription-status.ts` (`billing-state.ts` keeps working). Write `src/access/level.ts` with `accessLevel`, `graceEndsAt` and `GRACE_WINDOW_DAYS`, unit tested over every status, the null `past_due_since` case and the boundary. Create `src/app/(agency)/(gated)/` and move `dashboard`, `clients`, `projects`, `invoices` and `team` into it, leaving `billing` and `settings` where they are; write the gated layout with the `isClerkConfigured()` pass through, `agencyAccess()` and the redirect only (no banner yet), and add `src/app/(agency)/error.tsx` from the spec 0004 error state pattern. Add `subscription_inactive` to `ACTION_ERROR_CODES`, add `logGateInvariant` to `src/db/tenant/log.ts`, write `requireFullAccess(ctx)` in `src/db/tenant/subscription.ts` reading on the pooled executor, wire it into `withTenantAction()` after the role guard and before parsing (outside the transaction), turn the reserved slot into `subscription?: "any"`, and set it on `startCheckout` and `openBillingPortal`. Fix every switch the compiler now flags. Prove it: a fresh agency lands on `/billing`, subscribes in test mode, and reaches `/dashboard`; with the row hand set to `past_due` 8 days ago, `/clients` redirects and `createClient` is refused, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-9**, **AC-13**
2. [x] **The grace window.** Build `GraceBanner` in `src/access/ui/` as a region landmark with the admin variant (the existing portal button) and the member variant (sentence plus link), the UTC date line through `formatBillingDate`, and render it from the gated layout on `grace`. Make `client-form.tsx` and the archive and restore buttons show the refusal with a link to `/billing` on `subscription_inactive`. Add the wrapper tests for the order of checks and the exemption list to `src/payments/fence.test.ts`, satisfies **AC-5**, **AC-6**, **AC-7**
3. [x] **Locked, logging and the edges.** Build `LockedNotice` with its admin and member variants and render it on `/billing` when the level is `locked`. Log every wrapper refusal with `subscription_inactive:<level>`. Write the fail closed tests (the read rejects) for the layout and the wrapper, and the real PostgreSQL test in `src/access/gate.db.test.ts` that reads a seeded row through the scoped accessor and proves no row changed. Add the reachable pages layout test, satisfies **AC-4**, **AC-10**, **AC-11**, **AC-12**
4. [x] **Accessibility and the seed.** axe on both banner variants and the notice in both themes, the manual keyboard and screen reader pass, and add a `past_due` agency to `scripts/db-seed.ts` so the grace state is one seed away in development. Add the banner and the notice to `/design` in every state, satisfies **AC-14**

## Consequences

**Positive**:
- A grace window that expires on its own. No cron, no stored level, nothing to go stale.
- Writes are refused by construction. A new Server Action is gated the moment it uses the wrapper, and a new page is gated the moment it is placed under `(gated)`.
- The gate is a pure function with a full truth table, so the most consequential rule in the billing area is the easiest one to test.
- A locked agency can always pay: `/billing` and the two billing actions sit outside every gate the feature adds.
- Stripe is never on the request path. A Stripe outage changes nothing about who can read or write.

**Negative / tradeoffs**:
- One extra indexed read per agency page request and per Server Action. It is a primary key sized lookup on a unique column, but it is real, and on the write side it is a second round trip before the handler's own work starts.
- Layouts do not re render on client side navigation. An agency whose grace window lapses mid session keeps reading until its next full page load, and the banner appears or disappears on the same schedule. Writes are refused immediately by the wrapper regardless, so the leak is bounded to reads the agency was already allowed a moment earlier. Recorded as a follow up to measure rather than a reason to gate every page by hand.
- A stale mirror row is now a lockout. If the webhook dies with the row at `past_due`, a paying agency is locked after 7 days until feature 18's reconcile repairs the row. This spec keeps the gate honest about the row it has; the fix belongs to feature 18 and is called out below.
- Five route folders move. The paths do not change, but the diff is noisy and any open branch touching those pages will need a rebase.
- Adding a code to the closed error union touches every exhaustive switch in the product. That is the point, and it is also work.

**Neutral**:
- `SUBSCRIPTION_STATUSES` moves file. `billing-state.ts` imports it from the new module and its behaviour is unchanged.
- The reserved `subscription` slot on `ActionConfig` finally has a value. The `rateLimit` slot stays reserved for feature 19.
- The `(gated)` route group is a new place to look when a page unexpectedly redirects to `/billing`. Worth one line in `src/ui/AGENTS.md` or a new `src/access/AGENTS.md` when `/sync` runs.

## Follow-up

- [ ] Feature 15 (client portal) applies the contact rule fixed in the Security model: `locked` shows the unavailable page, `grace` and `full` read as normal, through `unsafeTenantQuery` with the reason `portal gate`. Its spec should reference this one rather than restate the table.
- [ ] Feature 18 (daily cron sweeps) owns drift detection: a nightly reconcile that lists active Stripe subscriptions and repairs any local row that disagrees. Spec 0007 flagged it and this feature makes the cost of a stale row concrete, so it should not slip.
- [ ] Measure whether the layout's "no re render on client navigation" gap matters in practice once real agencies exist. If a lapse mid session needs to lock sooner, `template.tsx` in the `(gated)` group is the first thing to try, and gating each page by hand is the last.
- [ ] Feature 16 (team members and roles) builds the real `/settings` page. It is reachable at every level by this spec, so any write it adds goes through the wrapper and is refused on `grace` like everything else; the page should say so rather than show a form that cannot save.
- [ ] When `/sync` runs, give `src/access/` its own short `AGENTS.md` (the four levels, the gated route group, and the rule that the gate never writes and never calls Stripe), and add a one line pointer from the root.
