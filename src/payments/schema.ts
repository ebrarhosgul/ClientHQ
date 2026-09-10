/**
 * What the two billing actions accept, which is nothing.
 *
 * Both are driven entirely from the session: the organization comes from the
 * tenant context, the role from the Clerk claim, the price from the
 * environment, and the customer from the row already in the database. Neither
 * takes an `org_id` argument, and there is nothing a form could send that would
 * change what either one does.
 *
 * The schema still exists because `withTenantAction` requires one, and because
 * "this input is deliberately ignored" is worth saying out loud. Both actions
 * are invoked from a `<form>`, so what arrives is `FormData`, and stripping it
 * to an empty object is the honest description of what is read from it.
 */
import { z } from "zod";

export const noBillingInput = z.unknown().transform(() => ({}) as const);
