/**
 * The input schemas for every contact action (spec 0009, AC-1, AC-2).
 *
 * These describe forms, not rows. The email rule mirrors `lowercaseEmail` in
 * `src/db/schema/zod.ts` (trim, lowercase, then validate), so what reaches the
 * `email = lower(email)` CHECK is already lowercase and the constraint never
 * fires for casing.
 */
import { z } from "zod";

import { clientId } from "@/clients/schema";

/** `client_contacts.id` is a uuid column; anything else resolves not found. */
export const contactId = z.uuid();

const contactFields = {
  name: z
    .string()
    .trim()
    .min(1, "Enter the contact's name.")
    .max(200, "Use 200 characters or fewer."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter the contact's email address.")
    .max(320, "Use 320 characters or fewer.")
    .pipe(z.email("Enter a valid email address.")),
};

export const addContactInput = z.object({ clientId, ...contactFields });

export const updateContactInput = z.object({ contactId, ...contactFields });

export const contactIdInput = z.object({ contactId });

export type AddContactInput = z.infer<typeof addContactInput>;
export type UpdateContactInput = z.infer<typeof updateContactInput>;
