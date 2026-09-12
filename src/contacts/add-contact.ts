"use server";

/**
 * Adding a named person to a client (spec 0009, AC-1).
 *
 * `org_id` comes from the context through the accessor and `client_id` from
 * the form, re read through the same accessor so a foreign client is
 * `not_found` and an archived one is refused before anything is written. The
 * duplicate email rule is the unique constraint, surfaced by the wrapper as
 * `conflict`; it is checked here first only so the message can name the field.
 */
import { and, eq } from "drizzle-orm";

import { clientContacts, clients } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";

import { addContactInput } from "./schema";

export type AddedContact = {
  readonly id: string;
};

export const addContact = withTenantAction({
  name: "addContact",
  input: addContactInput,
  revalidate: { paths: [{ path: "/clients/[id]", type: "page" }] },
  handler: async ({ input, db }): Promise<AddedContact> => {
    const client = await db.findById(clients, input.clientId);

    if (client === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (client.archivedAt !== null) {
      throw tenantActionError({
        code: "conflict",
        message: "This client is archived. Restore them to add contacts.",
      });
    }

    const existing = await db.findFirst(clientContacts, {
      where: and(
        eq(clientContacts.clientId, input.clientId),
        eq(clientContacts.email, input.email),
      ),
    });

    if (existing !== undefined) {
      throw tenantActionError({
        code: "conflict",
        message: "Someone with that email is already a contact of this client.",
        fieldErrors: {
          email: [
            "Someone with that email is already a contact of this client.",
          ],
        },
      });
    }

    const row = await db.insert(clientContacts, {
      clientId: input.clientId,
      name: input.name,
      email: input.email,
    });

    return { id: row.id };
  },
});
