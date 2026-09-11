# 0008. Subscription access gate: rationale

The decision record behind [index.md](index.md). `/develop` builds from the index; this file is the why.

## Context

Spec 0007 gives the product a `subscriptions` row per agency that mirrors Stripe, and it stops there on purpose: the row is written but nothing reads it to decide anything. Today an agency that has never paid, one on a free trial, one whose card was declined a month ago and one that cancelled all get the same product. The subscription is the only revenue the platform has, so the gap between "Stripe knows" and "the app acts" is the gap between a business and a demo.

The forces are mostly already fixed by earlier specs, and they pull in one direction. Spec 0001 wants the level derived at read time so a grace window expires with no job, wants the gate server side because the edge proxy cannot reach the Supabase pooler, and wants data never deleted by the gate. Spec 0002 left the `status` column without a CHECK so an unknown Stripe status is recorded rather than rejected, and asks the interpretation to treat that unknown as locked. Spec 0003 built the one wrapper every write goes through and reserved a slot on it for exactly this feature. Spec 0007 writes `past_due_since` on the database clock, once, so the window has a stable start. What is left is the exact truth table, where in the App Router the page side gate can live without looping on `/billing`, how a refused write reaches a form, what a member sees when only an admin can fix the problem, and what the client portal will do when it exists.

Two constraints shape the shape of the answer. Layouts in the App Router do not receive the pathname, so "gate everything except billing" cannot be a string comparison inside a layout. And the tenant layer's dependency direction matters: `src/db/tenant/action.ts` is infrastructure, and a gate rule that pulled UI types or the payments feature into it would tangle the one module the product's isolation rests on.

Not deciding means either every later feature invents its own check (feature 11's project writes, feature 13's invoices, feature 12's uploads) or none of them do. Both are worse than deciding once now, which is why the scope built this slice before any of them.

## Options considered

### Option 1: Derive the level at read time; enforce in a gated route group layout and the action wrapper

One pure function maps `(status, past_due_since, now)` to a level. A nested route group `(agency)/(gated)/` carries a layout that reads the level, redirects `unsubscribed` and `locked` to `/billing`, and renders the grace banner. `/billing` and `/settings` sit outside the group. `withTenantAction()` reads the same row after the role guard and refuses anything but `full` with a new error code, unless the action opts out.

**Pros**:
- Nothing is stored and nothing is scheduled. The window expires because time passes.
- The page gate is structural: the folder a page lives in decides whether it is gated, and a redirect loop on `/billing` is impossible by construction rather than by a path check.
- The write gate is the wrapper every action already uses, so a forgotten check is not a thing that can happen.
- Stripe is never on the request path.
- One truth table, one pure function, one test file that covers every row of it.

**Cons**:
- One extra read per page request and per action.
- Layouts do not re render on client side navigation, so a lapse mid session locks reads on the next full load rather than the next click. Writes lock immediately.
- Five page folders move into the group, which is a noisy diff.
- The wrapper grows one more responsibility.

### Option 2: Store the level on the row and expire grace with the daily cron

The webhook computes an `access_level` column when it writes the row, and the daily cron (feature 18) flips `grace` to `locked` when the window passes. Pages and the wrapper read one column.

**Pros**:
- The cheapest possible read: one column, no arithmetic, no clock.
- The level is visible in the database, easy to inspect and easy to override by hand.

**Cons**:
- The window expires when the job runs, not when the 7 days pass. A daily job means up to a day of extra grace, or a locked agency that paid an hour ago and waits for the next sweep. Spec 0001 rules this out explicitly.
- A stored derived value goes stale in every way the source can change without it, and the webhook is the only writer, so a bug there is a bug in two columns instead of one.
- It ties this feature to feature 18, which is not built.

### Option 3: Gate at the edge from a claim in the Clerk session

The webhook writes the level and `past_due_since` into the Clerk organization's public metadata; Clerk puts it in the session token; the proxy computes the level with no database call and redirects at the edge.

**Pros**:
- No database read on the page path at all, and the redirect happens before any rendering.
- The write path could read the same claim and skip its query too.

**Cons**:
- A second mirror. The webhook would write to Stripe's view into both PostgreSQL and Clerk, and the two can disagree.
- Session tokens refresh on their own schedule, so a payment that just succeeded stays locked until the token rolls, and a person can hold an open session past a change for longer than the window.
- The webhook now calls Clerk on every subscription event, which is a new failure mode inside the one handler spec 0007 works hardest to keep boring.
- It puts a product rule in the proxy, which spec 0001 kept to "signed in, has an organization" for good reason.

### Option 4: A guard call at the top of every gated page and action

No route group and no wrapper change. Each page calls `await requireAccess()` and each action calls it in its handler.

**Pros**:
- No folders move and the wrapper is untouched.
- Each page can pick its own rule, so a page that should stay readable when locked just omits the call.

**Cons**:
- Safe by discipline, not by construction. The first page that forgets the call is open, and nothing fails the build.
- It is the exact failure the proxy's public route list and spec 0003's accessor were designed to avoid, reintroduced one layer up.
- The same read repeated in every handler, and every future feature owes a test for the call it might have forgotten.

## Rationale

Option 1 is what specs 0001, 0002 and 0003 already point at, and the design conversation confirmed every piece of it: 7 days, `/billing` plus `/settings` reachable, Checkout first for a new agency, the banner for grace only, a server refusal rather than disabled controls, a new error code, no override column, the portal unavailable for a locked agency, the wrapper gated by default, and drift left to feature 18. Nothing in those answers needs a stored value or a job, so Option 2 solves a problem the product does not have while breaking a rule spec 0001 set on purpose. Option 3 is the one genuinely different idea, and it fails on the thing this whole area is built around: one mirror, written by one handler, read by everyone. Option 4 is the cheapest to write and the most expensive to own, because its cost is paid by whoever forgets.

The two places the design had real room were settled by constraints rather than taste. The page side gate lives in a nested route group because a layout cannot see the path, and a group makes the reachable pages a visible structural fact instead of an allow list someone has to keep in sync. The pure rule lives in `src/access/level.ts` with no import from the tenant layer, so `withTenantAction()` can call it without a cycle, while the cached page read lives beside it and is free to import the layer. Moving the status vocabulary out of `billing-state.ts` is the small price of that direction, since the gate should not import a chip tint to learn what `past_due` means.

Three smaller calls, made here so `/develop` does not: a `past_due` row with no `past_due_since` is `locked` and logged, because the alternative is a grace window with no end; the guard runs after the role guard and before parsing, so a signed in member is refused for the reason that fits and nobody learns whether their input was valid while their agency cannot save it; and the window is a named constant rather than an environment variable, because a product rule that differs between deployments is a support ticket nobody can reproduce. The clock is passed in as `now` for the same reason the webhook uses the database clock: the boundary must be testable to the millisecond, and a few seconds of skew across serverless instances is invisible against 7 days.

The one caveat worth saying out loud is the layout's behaviour on client side navigation. The Next.js docs are explicit that a layout does not re render on navigation, so a grace window that lapses while someone is clicking around locks their reads on the next full load, not the next click. Writes are gated by the wrapper on every call, so nothing can be saved in that gap, and what can be read is what they were entitled to read a moment earlier. That is a bounded, read only lag on a 7 day window, which is a reasonable trade for a gate that is structural; `template.tsx` is the first thing to try if it ever matters, and the follow up says so.

## Engineer's answers, for the record

| Question | Answer |
|---|---|
| Grace window | 7 days |
| Reachable when locked or unsubscribed | `/billing` and `/settings` |
| A brand new agency | Checkout first, card required; the trial lives on the Stripe Price (spec 0007) |
| Banner | Grace only |
| Writes in grace | Server refusal plus the banner; controls not disabled |
| Error code | New `subscription_inactive` |
| Manual override column | None |
| Client portal when the agency is locked | Unavailable; grace and full read as normal |
| Data model | No schema change |
| Wrapper default | Gated by default, `subscription: "any"` to opt out |
| Stale webhook row | Defer to feature 18's reconcile |
| References | None |
