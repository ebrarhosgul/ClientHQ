# Contacts

## Overview

The named people at each client, and the invitation that lets one of them into the client portal. A contact becomes a portal user by accepting a single use link sent by email. Settled by [spec 0009](../../docs/specs/0009-client-contacts-portal-invitations/index.md).

## Key files

| File | Owns |
|---|---|
| `src/contacts/token.ts` | The invitation token: build, parse and digest. Pure |
| `src/contacts/send-invitation.ts` | Sending and resending. Two writes around the email, not in one transaction |
| `src/contacts/accept-invitation.ts` | Accepting. The one action outside `withTenantAction`, because the person has no tenant yet |
| `src/db/tenant/invitation.ts` (outside this area) | The acceptance door that binds a Clerk user to the contact row. Only it writes `user_id` and `accepted_at` |
| `src/contacts/status.ts` | The invitation status, derived from the row and the clock and never stored |
| `src/contacts/limits.ts` | The per contact cooldown, the daily cap and the invite lifetime |
| `src/contacts/add-contact.ts`, `update-contact.ts`, `remove-contact.ts`, `revoke-invitation.ts` | The staff writes |
| `src/contacts/invitation-email.ts` | Composes the message, link and idempotency key. Pure |
| `src/contacts/expired-invites-sweep.ts` | The `expired_invites` nightly sweep |
| `src/contacts/log.ts` | One structured line per invitation event |

## Conventions

- The token is `<contact id>.<32 random bytes, base64url>`. Only its SHA-256 digest is stored, compared in constant time. The contact id in front means the accept path reads one row by primary key.
- The token exists only on the handler's stack, in the outgoing email and in the person's inbox. Never in a column, a log line, a returned value or an action argument the framework might record.
- At most one live link per contact. A resend replaces the digest.
- `invited_at` is stamped only after the provider accepts the email, so a failed send consumes neither limit.
- Status is derived, never stored: `not_invited`, `unsent`, `invited`, `expired` or `accepted`. Use `contactStatus()`.
- Emails are trimmed and lowercased in the Zod schema, so the `email = lower(email)` CHECK never fires for casing.
- Log lines carry the organization id, contact id and outcome. Never the token, the digest or an address.
- The organization on the accept path is read off the fetched row. The caller never supplies it.

## Gotchas

- **Sending never runs inside a transaction.** The pool holds one connection, so the two writes and the email are separate steps, and their order is the contract. A failure between them leaves an `unsent` row, never one claiming delivery.
- **`acceptInvitation` must let `redirect()` through.** Next's redirect is a thrown signal. Call it outside the `try`, and catch only the errors the action turns into a `Result`.
- **Binding requires `user_id is null` in the update's `where`**, so two accepts of one link produce one binding.
- **Changing an email clears any pending invitation** in the same statement, so the old link dies with the old address. An accepted contact's email cannot be changed; remove and add again.
- **This area has its own limits, separate from `src/rate-limit/`.** The cooldown and the 50 a day cap read `invited_at` and use no counter table. `src/invoices/` reuses `COOLDOWN_MINUTES` for its resend.
- **Removing a contact is a hard delete.** An accepted contact loses portal access on their next request because the resolver finds nothing.

## Agent skills

- [resend](../../.agents/skills/resend/) and [react-email](../../.agents/skills/react-email/): the invitation email
- [email-best-practices](../../.agents/skills/email-best-practices/): deliverability and accessible email
- [gdpr-data-handling](../../.agents/skills/gdpr-data-handling/): contacts are personal data

## Related specs

- [Spec 0009](../../docs/specs/0009-client-contacts-portal-invitations/index.md): the invitation flow and its invariants
- [Spec 0014](../../docs/specs/0014-client-portal/index.md): the portal a contact lands in
- [Spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md): the expired invites sweep

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
