# 0010. Projects: rationale

## Context

A project is the unit of work an agency delivers, and everything later in the product hangs off it: deliverables (feature 12) are files attached to a project, the client portal (feature 15) shows a client its own projects, and invoices (feature 13) bill for them. The `projects` table was designed in spec 0002 with its columns, its four status values, and an archived timestamp that is deliberately independent of status, but that spec stopped short of saying which status moves are allowed, what archiving freezes, or who may archive. Those rules are the real decision here; the screens are the same shape as client records (spec 0006), which is already built, verified, and reviewed.

Three forces shape the rules. First, the scope row insists that "status moves only through valid transitions", which a plain dropdown cannot honour and which two people clicking at once can break even when each click is valid on its own. Second, the codebase so far has no admin only action at all; the `requireRole` option on `withTenantAction` and the `requireAdmin` guard exist (spec 0003 and spec 0005) but nothing calls them, so the first feature to draw that line sets the pattern feature 16 (team members and roles) will follow. Third, "overdue" needs a definition of today, and nothing in the schema records an agency's timezone; the same question returns in feature 18 (the overdue invoice sweep), so the answer chosen here should be one that sweep can reuse.

Two existing pieces of code constrain the design. The tenant scoping layer's `update` matches a row by id within the org and nothing else, so a write that must be conditional on the current status has no way to express that today. And spec 0006 left a Follow-up asking what should happen when a client with projects is archived, which only this feature can answer.

The project's build approach is Tracer Bullet, so the plan should reach a real create landing on a real list and detail page, tenant scoped, before it reaches filters, status moves, or polish. Every screen must meet WCAG 2.2 AA including its empty and error states, and the tier is GA, so the feature is verified, tested, and reviewed by a fresh model before it is documented.

## Options considered

### Option 1: The client records pattern, with a free status dropdown

Copy spec 0006 exactly: URL driven server components for the lists, Server Actions for every write, all through the tenant layer, and put status on the edit form as a dropdown where any value can be chosen. Archive and restore open to every staff member, like clients.

**Pros**:
- The smallest build; every piece has a worked example in `src/clients/`.
- No change to the tenant layer, no new pattern for anyone to learn.

**Cons**:
- Does not meet the scope row: any status can jump to any other, so "valid transitions" is a convention, not a rule.
- Two staff editing the same project at once can silently undo each other's status change, and a stale form can submit again a status the project left minutes ago.
- No admin line, so closing out work is as easy to do by accident as it is on purpose.

### Option 2: The client records pattern, plus a compare and set status move and admin only archive

The same screens and actions as Option 1, but status leaves the edit form. The detail page renders one button per move that is valid from the current status (the rule lives in one pure module the page and the action both read), each button submits the status it was rendered from, and the action's write is conditional on that status still being current, which needs one optional extra condition on the tenant layer's `update`. A stale click returns `conflict` and the page renders again with the fresh buttons. Archive and restore take `requireRole: "admin"`. "Today" for overdue is the server's UTC calendar day.

**Pros**:
- Meets the scope row exactly: the only moves that exist are the valid ones, and a race cannot skip a stage.
- The conditional `update` is a small, general addition to the tenant layer that invoices will need too.
- The admin line uses machinery that already exists, so feature 16 inherits a pattern instead of designing one.
- No migration, no dependency, no environment variable.

**Cons**:
- One more error path (`conflict`) for the UI to show well, and one more thing for a database test to prove.
- The tenant layer's public surface grows, so spec 0003's documentation of it goes slightly stale until `/sync` runs.
- The UTC day is a few hours off for most agencies; exact timing is deferred.

### Option 3: Separate status actions and a status history table

Four actions (`startProject`, `sendToReview`, `deliverProject`, `reopenProject`), each writing a row to a new `project_status_events` table (from, to, who, when) in the same transaction as the move, so every change is attributable, plus per agency timezone stored on `organizations` for exact overdue timing.

**Pros**:
- A full audit trail from day one, and an exact answer to "who delivered this and when".
- Each action is self describing, with no `from` and `to` input to validate.

**Cons**:
- A migration for two schema changes nobody has asked for yet, and a settings screen for the timezone that no feature currently owns.
- Four actions carry one rule spread across four files; the transition table still has to exist somewhere for the page to know which buttons to render.
- It does not, on its own, solve the race; each action still needs the conditional write.

## Rationale

Option 2 is the decision because it is the smallest design that actually honours the scope row. The row asks that status moves only through valid transitions, and Option 1 cannot deliver that beyond a convention: a dropdown that lists every status, or an action that validates against a row it read a moment ago, both let a stale or simultaneous submit land a move the rule forbids. The compare and set costs one optional condition on a tenant layer function and one `conflict` message; that is cheap insurance for a rule the product explicitly asked for, and the same condition is exactly what invoices will need when "issue" and "mark paid" must not race. The engineer chose to protect only the status move this way and leave name, description, and due date as last write wins, matching spec 0006; that is the right split, because a skipped stage is a real harm to the client relationship and an overwritten description is not.

The admin only archive was the engineer's call against the recommendation to keep every action open to all staff as clients are. It is a reasonable line: archiving is how a project stops, and the machinery to enforce it (`requireRole: "admin"`, reading the Clerk claim rather than the `memberships` mirror) already exists and was waiting for a first caller. Establishing it here, on a low stakes action with a confirm dialog, is a better place to set the pattern than feature 16 inventing it under pressure.

Option 3 is the right shape for a later day, not this one. A status history and a timezone column each add a migration and a screen for a need nobody has voiced, and neither solves the race that Option 2 solves. `isOverdue` takes today as a parameter and `transitionProject` is a single function, so both of Option 3's additions can be layered on later without redoing this feature: a history table is one more write inside the existing transaction, and an agency timezone is one different argument.

The remaining choices followed from the answers. Delivered is final because reopening a delivered project would mean a client saw "delivered" in the portal and then did not; archive and recreate is the honest correction. The client is fixed after creation because deliverables and invoices will inherit it and moving them silently would move client visible files. The four statuses stay as they are because archiving with the status kept already covers "paused" and "cancelled" without a migration. The `/projects` default hides delivered projects because the list is a work list, and the client page section shows only active projects newest first because a client's page is about the relationship now, with archived work one link away. Archiving a client with active projects warns with a count rather than blocking, because the block would force staff to archive each project first for no safety gain: the projects stay reachable on `/projects` either way.
