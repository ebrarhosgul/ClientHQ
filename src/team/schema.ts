/**
 * Zod at the action boundary (spec 0015, AC-2, AC-4 to AC-6). The email is
 * trimmed and lowercased here, once, so every comparison downstream is
 * against the same shape Clerk's lists are lowercased to.
 */
import { z } from "zod";

import { MEMBERSHIP_ROLES } from "@/db/schema";

export const roleInput = z.enum(MEMBERSHIP_ROLES);

export const inviteInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address.")
    .max(254, "That email address is too long.")
    .pipe(z.email("Enter a valid email address.")),
  role: roleInput.default("member"),
});

export type InviteInput = z.infer<typeof inviteInput>;

export const invitationIdInput = z.object({
  invitationId: z.string().trim().min(1),
});

export const membershipIdInput = z.object({
  membershipId: z.string().trim().min(1),
});

export const changeRoleInput = membershipIdInput.extend({
  role: roleInput,
});
