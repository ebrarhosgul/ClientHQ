/**
 * The two boundaries `src/auth/webhook.ts` parses instead of casting (spec
 * 0015): the identifier fields of the three payload shapes it reads off a
 * verified event, and the three re read results it applies. Neither ever
 * decides an outcome; a failed parse here is the "Clerk's shapes moved"
 * surprise `src/payments/events.ts` also treats as loud on purpose.
 */
import { z } from "zod";

/** `user.updated` / `user.deleted`: `data.id`. */
export const userEventData = z.object({ id: z.string().min(1) });

/** `organization.created` / `.updated` / `.deleted`: `data.id`. */
export const organizationEventData = z.object({ id: z.string().min(1) });

/**
 * `organizationMembership.created` / `.updated` / `.deleted`:
 * `data.organization.id` and `data.public_user_data.user_id`.
 */
export const membershipEventData = z.object({
  organization: z.object({ id: z.string().min(1) }),
  public_user_data: z.object({ user_id: z.string().min(1) }),
});

/**
 * The organization re read, reduced to the columns `upsertOrganizationRow`
 * writes. Parsed after the presence check, so a shape the mapping in
 * `src/auth/clerk.ts` no longer produces fails loud rather than writing
 * whatever happened to come back.
 */
export const mirrorOrganizationRead = z.object({
  clerkOrgId: z.string().min(1),
  name: z.string().min(1),
});

/**
 * The user re read, reduced to the columns `ensureUserRow` writes.
 *
 * `name` and `imageUrl` are a union with `z.undefined()` rather than
 * `.optional()`: `MirrorUser` requires both keys present with a possibly
 * `undefined` value, and `.optional()` would make Zod's inferred type mark
 * the key itself optional instead, which does not structurally match.
 */
export const mirrorUserRead = z.object({
  clerkUserId: z.string().min(1),
  email: z.string().min(1),
  name: z.union([z.string(), z.undefined()]),
  imageUrl: z.union([z.string(), z.undefined()]),
});

/** The membership re read, reduced to the one column it contributes. */
export const membershipRoleRead = z.object({
  role: z.string().min(1),
});
