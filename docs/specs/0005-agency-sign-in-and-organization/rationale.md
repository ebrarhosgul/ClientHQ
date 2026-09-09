# 0005 rationale: agency sign in and organization

The build spec is in [index.md](index.md). This file holds the reasoning, the options weighed, and why the chosen one won.

## Context

> ⚠️ Premise note: the feature is named after sign in, but sign in is the smallest part of it. Clerk's own components handle the credentials, the verification and the bot defence, so that surface is a few lines. The load bearing work is everything around it: narrowing `src/proxy.ts` so the product stops being publicly readable, deciding where a person with no agency is sent, and creating the local mirror rows that spec 0003 deliberately refuses to create. Reading this as an auth feature would size it wrong and would leave the two genuinely risky parts, route protection and unscoped provisioning writes, to be improvised during the build. It is sized here as a provisioning and routing feature that happens to mount two Clerk components.
>
> A second note on sequencing: features 3 and 4 are still `in-progress` in the scope, and this feature amends spec 0003's staff resolution query. Spec 0003 should not be closed out before this lands, or the amendment loses its home.

Three earlier specs each left a piece of this feature on the floor, deliberately, and this is where they are picked up.

Spec 0001 chose Clerk for sign in and for agency organizations, fixed the routes (`/`, `/sign-in`, `/sign-up`, then `/dashboard` and the rest of the agency area), and said that a request finding no matching local row should repair it from the Clerk API on the spot so a webhook missed during a deploy never strands a user.

Spec 0003 then built the tenant scoping layer and made a firm decision that changed the shape of that promise: resolution reads and never writes. It resolves who is asking from the Clerk session, and when the local `organizations`, `users` or `memberships` rows are missing it raises a typed `no_mirror_row` rather than repairing anything. It raises `no_active_org` separately for a signed in person with no organization selected. Both were made typed and distinct specifically so this feature could route each one. The safety net still has to exist; it just has to live one layer up.

Spec 0004 built the design system and, to show a real agency name in the chrome rather than a fixture, wired `ClerkProvider` and a `src/proxy.ts` with **every route public**. That is safe only while `/dashboard` renders an empty body, and spec 0004 names it the single real hazard in the feature. It sits in `main` today. Feature 7 puts real client rows behind an agency route, so the matcher has to be narrowed before that, and this feature is the last one before it.

The forces that shape the answer are narrow and mostly already fixed. Clerk is chosen and installed. The three identity tables already exist with their constraints: `organizations.slug` is not null and unique, `users.email` is not null with a lowercase check, `memberships` is unique on the organization and user pair. Roles come from the Clerk session claim and never from `memberships.role`, which is a display mirror. One person is building this on free and student tiers, so anything with an operational cost of its own is expensive in the only currency that is short. And the load bearing rule of the whole repository is that nothing outside `src/db/tenant/` may reach the raw database handle, with the one unscoped door, `withSystemAccess`, fenced by ESLint to exactly three route files.

That last force is the sharp one. Provisioning the mirror rows happens **before** a tenant context exists, so by definition it cannot go through the scoped accessor. Not deciding this means whoever builds it reaches for the nearest unscoped door and widens a security fence in passing.

## Options considered

### Option 1: Clerk's hosted Account Portal, with Clerk's own organization gate

Redirect `/sign-in` and `/sign-up` to Clerk's hosted pages, turn on Clerk's setting that requires an organization before letting anyone through, and let Clerk's `<CreateOrganization />` collect the name. Mirror rows arrive later from feature 17's webhook.

**Pros**:
- Almost no code. The auth surface, the organization gate and the creation form are all configuration.
- Clerk owns every edge case in the flow, including verification, OAuth callbacks and bot defence.

**Cons**:
- The person leaves your domain in the middle of signing up, and comes back to a differently styled product. Spec 0004 spent a whole feature making the look consistent.
- The organization gate cannot branch. An invited client contact, who by design has no agency, is pushed into creating one.
- Mirror rows depend entirely on a webhook that does not exist until feature 17, so the walking skeleton has no local `organizations` row and cannot prove server side tenant context at all.

### Option 2: Clerk components on your own routes, your own onboarding action, and a lazy mirror repair (chosen)

Mount `<SignIn />` and `<SignUp />` on catch all routes at the paths spec 0004 pinned, themed to the project's tokens. Narrow the proxy to protect everything except an explicit public list, and send a signed in person with no active organization to `/onboarding`. That one route branches on how many memberships Clerk reports: activate a sole one, offer a picker for several, show a create form for none. Creating an agency is your own form posting to a Server Action that creates the Clerk organization first, then writes all three local rows in one transaction. Separately, when staff resolution raises `no_mirror_row`, the agency layout repairs the rows from the Clerk backend API and resolves again.

**Pros**:
- The URLs stay yours, the look stays yours, and Clerk still owns the parts that are dangerous to write by hand.
- Every branch that spec 0003 made typed gets routed, including the client contact case, so the layer's error taxonomy is actually used rather than decorative.
- The repair is spec 0001's promised safety net, and it costs nothing on the normal path because the resolution query has already run and found the rows.
- Agency creation is a server side action, so it can be Zod parsed, role checked, logged and tested like every other write in the product.

**Cons**:
- More code than option 1, and the theming of Clerk's components has to be re checked whenever Clerk changes their internals.
- Provisioning writes are unscoped by nature, so this option has to answer how they reach the database without widening an existing security fence. That answer is the extra design work below.
- The half failure case is real: Clerk can succeed and the local transaction fail, leaving an organization with no mirror.

### Option 3: Fully custom sign in and sign up forms on Clerk's hooks

Build the markup yourself on `useSignIn` and `useSignUp`, keeping Clerk only as the identity backend.

**Pros**:
- Complete control of every field, so WCAG 2.2 AA is entirely in your hands rather than partly in Clerk's.
- No appearance mapping to maintain, because there is nothing to map.

**Cons**:
- You own multi step verification, OAuth callbacks, error taxonomy and every future Clerk change, permanently, on the one flow where a bug locks every user out of the product.
- It is the reinventing auth failure pattern wearing a thin disguise. The hooks are lower level, not safer.
- Enormous cost against a benefit spec 0004 already largely bought: the tokens make Clerk's components look native without rewriting them.

### Option 4: No provisioning here at all, defer every mirror write to feature 17's webhook

Ship sign in, the matcher and onboarding, but let the Clerk webhook be the only thing that ever writes `organizations`, `users` and `memberships`.

**Pros**:
- One writer for the mirror, so there is no chance of two code paths disagreeing about what a row should contain.
- No unscoped provisioning question to answer in this feature.

**Cons**:
- Feature 17 is in slice 8. Until then nothing writes the local rows, so tenant context can never resolve and the walking skeleton does not walk.
- It removes exactly the safety net spec 0001 asked for. A webhook missed during a deploy strands a user with no way back, which is the failure mode the net exists to catch.
- It makes the first successful sign up depend on a webhook round trip, so a new agency lands on a broken dashboard and has to refresh.

## Rationale

Option 2 wins on the force that matters most here: the walking skeleton has to actually walk. The scope calls slice 1 the thinnest real thread through every layer, and the thread's whole point is that `/dashboard` can name the agency from your own `organizations` row, which proves the Clerk session resolved a server side tenant context through spec 0003's layer. Options 1 and 4 both leave that row unwritten until feature 17, so both produce a slice that looks finished and proves nothing. Option 3 buys control the project does not need at a cost the project cannot afford, on the flow with the worst blast radius, and it is the reinventing auth pattern.

The two forces that shaped the details rather than the choice were the fence and the half failure.

**On the fence.** Provisioning runs before a tenant exists, so the scoped accessor cannot express it. The nearest existing door is `withSystemAccess`, but that hands over the entire database and is fenced by ESLint to the two webhook routes and the cron route, with `tools/eslint/tenant-isolation-config.test.mts` failing if that list and spec 0003 drift apart. Widening it would give the auth module reach over `clients`, `invoices` and every other tenant table to write three identity rows. The narrower answer is to add no general door at all: two purpose built functions, `ensureMirrorRows` and `createAgencyRows`, live inside `src/db/tenant/` in a new `provisioning.ts`, touch only the three identity tables, and hand the raw handle to nobody. `src/auth/` imports those two functions and never a handle. The existing `no-raw-db-import` rule already permits `src/db/tenant/**`, so no exemption list grows, and because no callback receives a `Database` there is nothing new to fence. The runner up was a generic `withIdentityProvisioning(reason, fn)` door in the shape of `withSystemAccess`, rejected because a general door invites general use, and the whole value of spec 0003's design is that reaching the database unscoped is awkward on purpose.

**On the half failure.** Clerk has to be created first, because `organizations.clerk_org_id` is not null and unique so there is no valid local row to write before Clerk has answered. That means the local transaction can fail after a real Clerk organization exists. The tempting fix is a compensating delete, but a destructive call against the identity provider, fired automatically in response to an unrelated database error, is a worse failure than the one it cleans up, and the compensating delete can itself fail. The better answer is that the orphan is not an orphan at all: an organization in Clerk with no mirror is precisely the `no_mirror_row` case, and the lazy repair heals it on the person's very next request. The failure mode this feature has to design for turns out to be one it already handles.

Two smaller calls are worth recording. The slug is generated from the agency name rather than chosen, because spec 0001 fixed that no slug ever appears in a URL, so a chosen slug would buy a field, a validation rule and an availability endpoint for something nobody sees. The derived value is offered to Clerk as well, but the local column is always resolved by the same uniqueness helper and never copied back from Clerk. That asymmetry looks fussy until you follow the failure through: if the local write failed on a slug collision, the Clerk organization now holds the colliding value, and a repair that copied it would retry the identical violation on every request forever. The two values may therefore diverge after a race, which costs nothing because nothing reads either one. And `/onboarding` counts memberships by asking **Clerk**, not the database: `memberships` is a tenant scoped table, a cross organization read of it has no context to scope by, and Clerk is authoritative for membership anyway while the local column is explicitly a display mirror. Asking Clerk sidesteps a scoping problem instead of carving an exception for it.

## Amendment to spec 0003

This feature adds a `deleted_at is null` predicate to the staff resolution query in `src/db/tenant/context.ts`, so a soft deleted agency resolves as absent rather than as a live tenant. Spec 0003 wrote that query before `organizations.deleted_at` had any writer; feature 17's webhook becomes the writer, and without the predicate a soft deleted agency would keep serving its rows. Spec 0003 carries a pointer to this amendment rather than being left to contradict it.

## Cross check corrections

An independent model read the first draft and found ten gaps, all closed before this spec was accepted. Two were real bugs rather than omissions, and both are recorded here because they are the kind that come back.

The first was a redirect loop. The proxy's no active organization rule was written globally, but a client contact by design never carries an organization claim, so `/portal` would have bounced them back to `/onboarding` on every single load. The rule is now scoped to the agency paths, with `/onboarding` and `/portal` explicitly outside it, and that exemption carries its own acceptance criterion so it cannot be quietly dropped.

The second was the slug repair loop described above, where the healing mechanism could not heal the one failure it existed for.

The other eight were smaller but each would have become a question partway through the build: the repair had no named source for the membership role (the session claim already carries it, so no extra Clerk call was needed), the repair's failure taxonomy contradicted itself between the state diagram and the API table, the upsert conflict behaviour was unnamed, the environment variable criterion was unfulfillable as written because Clerk reads those variables itself, the public route list needed wildcards for Clerk's own sub steps, a person who is both staff and a contact had no declared precedence, `setActive` could outrun the cookie write, and a double submitted form could mint two Clerk organizations.
