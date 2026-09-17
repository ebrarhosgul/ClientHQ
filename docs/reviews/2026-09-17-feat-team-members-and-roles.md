# Review, feat/team-members-and-roles, 2026-09-17

**Reviewed by**: Claude Opus 5 (1M context) (author on Claude Opus 5 / Claude Sonnet 5, per the commit trailers)
**Scope**: 53 committed files + 1 untracked, branch vs `main` (merge base `27852ca`)
**Verdict**: Changes requested

**Update, 2026-09-17**: the four Minors marked ✅ below were fixed in the same branch: `src/team/schema.ts` (email validation now short circuits via `.pipe(z.email())`), `src/team/ui/invite-form.tsx` (focus returns to the address field after the post success remount), `src/team/ui/remove-member-button.tsx` (the last admin reason is now an accessible description, not a `title` tooltip), and `src/ui/primitives/table.tsx` / `src/ui/patterns/data-table.tsx` / `src/team/ui/members-table.tsx` (the scroll container's tab stop is now opt in, and only `/team`'s Members table opts in, for the member view and the solo admin view, the two states that can render with no other focusable descendant). Typecheck, lint, format and the full suite (3254 tests) are green. The Major (the tracer bullet slice) and the remaining Minors and Nits are unchanged.

## Summary

Spec 0015 lands `/team` and four Server Actions over Clerk's organization endpoints, with a write-through to the local `memberships` mirror. The tenancy and permission work is genuinely good: every Clerk call carries `ctx.clerkOrgId`, every target id is resolved against the acting organization's own list before anything is written, all four actions declare `requireRole: "admin"` with the default subscription gate, nothing anywhere reads `memberships.role` to decide what a person may do, and the mirror write only ever touches the one `memberships` row through `tenantDb(ctx)`. The AC-12 hardening of spec 0005's repair path is a real fix, not a token one. Typecheck, lint and 3252 unit tests are green.

The headline issue is not in the code: the spec's own Tracer Bullet slice — a real invitation accepted end to end on the deployed app — is still unticked, and it is the one thing spec 0015 said must be proven before anything else was built. Beyond that there is a verified user-visible validation-message bug, a handful of small UI/accessibility deviations from AC-14, and one product-wide accessibility change made to solve a single page's problem.

## Major

### 🟠 The feature's tracer-bullet slice is still unproven on the deployed app, `docs/specs/0015-team-members-and-roles/index.md:143`

**Problem**: Build plan slice 2 is unticked and says so honestly: "**Not yet proven on the deployed app**: the real invitation email, the ticket landing on `/sign-up`, the existing account bounce to `/sign-in`, and `/onboarding` activating the agency". `verify.md:25-26` leaves both acceptance walks unchecked, and slice 12 (the Playwright walk of `/team` as admin and as member) is unticked too. The spec ordered this slice first precisely because "the invite path crosses Clerk's email, the ticket handling in the prebuilt sign up component, and spec 0005's onboarding, and that is the part most likely to surprise" (line 139), and it named the fallback if it fails: "a small `/team/accept` page using Clerk's ticket strategy, which would be a spec update, not a redesign" (line 179).

**Why it matters**: Everything downstream of `createOrganizationInvite` is unexercised. If Clerk's prebuilt `/sign-up` does not consume the ticket, or hands an existing account to `/sign-in` without keeping it, every invitation sent in production reaches a dead end, and the remedy is a new page plus a spec amendment — not a merge-time patch. The unit tests cannot see any of this: they stop at the stubbed Clerk boundary.

**Suggested fix**: No code change expected. Before merge, deploy the branch and run `verify.md:25` and `verify.md:26` with a second mailbox — one brand new address, one that already has an account — and tick them. If either fails, the spec's own fallback applies and this should go back to `/architect` rather than merge.

## Minor

### ✅ Fixed: An empty invite address shows two stacked error messages, `src/team/schema.ts:14`

**Problem**: `inviteInput.email` is built as `z.string().trim().toLowerCase().min(1, …).max(254, …).email(…)`. In Zod 4 the string checks do not short-circuit, so an empty submit collects both issues. Verified by running the schema directly: `safeParse({ email: "" })` returns `["Enter an email address.", "Enter a valid email address."]`, and `Field` renders `error.join(" ")` (`src/ui/primitives/field.tsx:88`), so the person sees the literal sentence "Enter an email address. Enter a valid email address." The form is `noValidate` (`src/team/ui/invite-form.tsx:97`), so an empty submit is reachable. `src/team/schema.test.ts:43` uses `toContain`, which passes on an array with both messages and so does not catch this.

Separately, this is the only email schema in the repo still using the method form. `src/clients/schema.ts:33`, `src/contacts/schema.ts:28` and `src/db/schema/zod.ts:24` all use `.pipe(z.email(…))`, which is the Zod 4 shape and short-circuits so only one message survives. `z.string().email()` is deprecated in Zod 4.

**Why it matters**: A user-visible wording defect on a WCAG-relevant surface (the message is inside `role="alert"`), and a convention drift from three other schemas that already got this right.

**Suggested fix**: Match the other schemas: keep `.trim().toLowerCase().min(1, …).max(254, …)` and `.pipe(z.email("Enter a valid email address."))`. Then tighten the schema test to assert the exact message array rather than `toContain`.

### ✅ Fixed: The locked remove button puts its reason in a `title` tooltip, `src/team/ui/remove-member-button.tsx:46`

**Problem**: AC-14 is explicit that when the acting admin is the only admin, the reason "sits next to them, **not in a tooltip**". The disabled button carries `title={LAST_ADMIN_REASON}`. The visible text does exist, but only because `MemberRoleSelect` renders it in the adjacent Role cell — the button itself relies on a tooltip.

**Why it matters**: `title` on a `disabled` button is not reachable by keyboard, is not shown on touch, and is inconsistently exposed by screen readers. It is the exact affordance the acceptance criterion rules out.

**Suggested fix**: Drop the `title` and let the visible text in the Role cell be the sole carrier of the reason, or reference that text from the button with `aria-describedby` so the association is explicit rather than incidental.

### ✅ Fixed: Every table in the product gained a tab stop to fix one page, `src/ui/primitives/table.tsx:10`

**Problem**: `tabIndex={0}` is now unconditional on the shared table container. The comment is honest about the cause (a `/team` row where every control is disabled leaves no focusable descendant, which trips axe's `scrollable-region-focusable`), but the fix is applied to every `DataTable` in the product — clients, projects, deliverables, invoices, contacts — including tables that never overflow and already have focusable descendants.

**Why it matters**: A keyboard or screen reader user now hits an extra, unnamed stop before every table in the app. `scrollable-region-focusable` only requires this of a container that actually scrolls and has no focusable content; making it universal trades a narrow page-specific problem for a small product-wide one.

**Suggested fix**: Scope it — either make `tabIndex` a prop the `/team` members table opts into, or give the container an accessible name (`role="region"` + `aria-label` from the table caption) so the stop announces something useful when a user lands on it.

### ✅ Fixed: Focus is thrown away after a successful invite, `src/team/ui/invite-form.tsx:64`

**Problem**: The action calls `emailRef.current?.focus()` and then returns state with `generation: previous.generation + 1`. That value is the `<form key>` on line 95, so React unmounts and remounts the form subtree — destroying the very input that was just focused. Focus lands on `<body>`.

**Why it matters**: The code shows clear intent to return focus to the address field for the next invite, and it silently does not work. A keyboard or screen reader user has to tab from the top of the document after each invitation, and the `role="status"` announcement on line 151 is the only cue they get. No test covers the focus position, which is why it went unnoticed.

**Suggested fix**: Reset the input by other means (set `value`/`defaultValue` from state without remounting, or call `form.reset()`), or move the focus call into an effect that runs after the remount. Add an assertion on `document.activeElement` to the invite-form test.

### 🟡 The role select never re-syncs with the server's value, `src/team/ui/member-role-select.tsx:54`

**Problem**: `current` is seeded from the `role` prop with `useState` and only ever changed by this component's own successful action. The row key is the stable `membershipId` (`src/team/ui/members-table.tsx:149`), so a `router.refresh()` that brings a different role from Clerk does not remount the component and the prop change is ignored.

**Why it matters**: After a concurrent change by another admin (the two-admin race the spec's Consequences already acknowledges), the page refreshes but the select keeps showing the stale role, so the admin is looking at a control that disagrees with the Members count line rendered right beside it from the same fresh read.

**Suggested fix**: Derive the displayed value from the prop and keep only the optimistic override, or key the local state on the incoming `role` so a server-side change wins.

### 🟡 The pending-invitation list pages by offset with no stable order, `src/auth/clerk.ts:399`

**Problem**: `organizationMembers` pins the order with `orderBy: "-created_at"` (line 361) before offset-paging, which makes the pages consistent. `organizationPendingInvitations` passes only `status: ["pending"]`, `limit` and `offset`, and sorts by `createdAt` afterwards in memory (line 409). Offset paging over a list with no declared order is only safe if the backend's default happens to be stable.

**Why it matters**: The list this reads is the one AC-3's duplicate check runs against and the one AC-4 resolves a revoke id in. On an organization with more than 100 pending invitations, a shifting order across offset requests can drop or duplicate rows, which would let a duplicate invite through or make a live invitation look `not_found`. Bounded to large invitation backlogs, so not urgent, but it is the same class of bug the members helper deliberately avoided.

**Suggested fix**: Pass the same `orderBy: "-created_at"` (or whatever the invitation endpoint accepts), and drop the after-the-fact sort, so both helpers page the same way.

### 🟡 AC-8's refusals are asserted from config, never exercised, `src/team/actions.test.ts:56`

**Problem**: The action tests replace `withTenantAction` wholesale with a fake that parses and calls the handler. The admin guard and the subscription gate are therefore asserted only as recorded config values (`requireRole === "admin"`, `subscription === undefined`, lines 148-156). Spec 0015's own critical test scenarios ask for something stronger: "a member calls each of the four actions and receives `forbidden`, with the Clerk stub recording zero calls" and "an agency in the grace window calls invite and receives `subscription_inactive`".

**Why it matters**: The wrapper's guards are well covered generically in `src/db/tenant/action.test.ts`, so the mechanism works — but the composition of *these four actions* with those guards is argued rather than demonstrated. If a future refactor moved a Clerk read above the guard (into a module-level call, say), the config assertion would still pass.

**Suggested fix**: Add one test per action that runs the real `withTenantAction` with a member context and asserts `forbidden` plus zero calls on the Clerk stub, and one grace-window case. The wrapper is importable; only `tenantContext` and `requireFullAccess` need stubbing.

## Nits

- ⚪ `src/team/log.ts:26`, `outcome` is typed `string` with the allowed values listed only in a doc comment, and `unavailableOutcome` (`src/team/clerk-failure.ts:19`) returns `string` too. A union type would make AC-13's vocabulary enforceable and matches the project's "types are strict, exhaustive switches over the status enums" rule.
- ⚪ `src/team/invite-team-member.ts:48`, AC-13 says the target is `"none"` for an invite that stopped before Clerk created anything; the implementation omits the field instead. The absence conveys it, but a grep for `"none"` in the logs will not find these lines.
- ⚪ `.vercelignore` (untracked), unrelated to this feature and uncommitted. It has no effect on Vercel's git deploys but does change a `vercel` CLI deploy, so the repo and a local deploy silently disagree. Commit it with its own `chore:` message or drop it.
- ⚪ `src/team/ui/member-role-select.tsx:91`, `aria-describedby` points at an element that is also a `role="status"` live region. It works, but referencing a live region as a description tends to produce a double announcement; a separate static element for the locked reason would be cleaner.
- ⚪ `src/app/design/gallery.tsx:947`, the gallery renders the real `InviteForm` and `RemoveMemberButton` wired to the live actions. `/design` `notFound()`s in production so this is contained, but in development a signed-in admin can send a real invitation to their real agency from the design gallery.

## Strengths

- Tenant isolation is airtight and easy to audit: every Clerk call takes `ctx.clerkOrgId`, every membership and invitation id is resolved through `findMembership`/the pending list before any write, and `src/team/mirror.ts` reaches the mirror only through `tenantDb(ctx)` and only ever touches `memberships`, never `users`. The comment explaining why `users` is off limits (shared across agencies, `memberships.user_id` cascades) is exactly the kind of note that stops a future edit from causing a cross-agency deletion.
- The session-claim-versus-mirror rule is respected without exception. A grep across `src/team` finds role comparisons only against Clerk's list or `ctx.role`; `memberships.role` is never read for a decision.
- AC-12's hardening of `repairMirror` is a real fix to a pre-existing hole, and it fails closed: the role now comes from Clerk's membership list rather than the token, and no membership means `/onboarding` rather than a resurrected row. The test for the stale admin claim (`src/auth/context.test.ts`) asserts the right thing — Clerk wins over the claim.
- The half-done handling in `changeTeamMemberRole` and `removeTeamMember` is correct and well argued: Clerk is authoritative, the mirror failure logs at error level and still returns `ok`, and the three `unavailable` messages distinguish "nothing changed" from "may or may not have applied". The `read`/`write` phase parameter is a tidy way to keep that honest at every call site.
- Test quality is high overall: `duplicateEmail` covers the member-wins-over-invitation precedence, `lastAdminBlocks` covers the "a member is never the last admin, even alone in the list" case, the Clerk wrappers test paging to the total count and the 400/422/404/429 split, and `team-page-view.test.tsx` runs axe over the admin, solo-admin, member and error states in both themes.
- The documentation discipline is unusually good. `verify.md` lists what was *not* checked as a "Known gaps" section rather than leaving ticks ambiguous, and the build plan's "Proven:" lines say what was and was not demonstrated. The Major above exists because of that honesty, not in spite of it.

## Test coverage

`TESTS = configured`. The suite is green (3252 tests, 214 files) and the new logic is well covered: pure rules, Zod schemas, the six Clerk wrappers including paging and status mapping, the four actions against a stubbed Clerk and mirror, the mirror write-through, `loadTeam`'s admin-only invitation read, the page's own prop wiring, and every UI component including the confirm dialog wordings and axe in both themes.

Three gaps worth naming:

1. **AC-8 end to end** (Minor above): the member-`forbidden` and grace-window-`subscription_inactive` scenarios the spec asks for are asserted from the recorded config, not by running the guard.
2. **Focus behaviour**: neither the invite form nor the remove dialog asserts where focus lands after a successful action, which is how the invite-form focus bug (Minor above) slipped through. AC-14 makes focus management part of the contract.
3. **`allPages` edge branches** (`src/auth/clerk.ts:312`): the `data.length === 0` guard and the "total moved under us" short-page case are unexercised. The last-admin rule and the duplicate check both depend on that helper returning a complete list, so the branch that protects against truncation is worth one test each.

Nothing here is a missing-test-for-untested-logic problem; it is a matter of the three highest-consequence behaviours being covered one level removed from where they actually run.
