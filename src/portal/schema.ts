/**
 * The input schemas every portal route and action parses against (spec 0014,
 * AC-6, AC-8, AC-9, AC-11): the `page` search param and the `id` route params,
 * both uuid, and `switchContact`'s input.
 */
import { z } from "zod";

/** Every portal route's `id` param: `projects.id`, `invoices.id`, a contact id. */
export const portalId = z.uuid();

/**
 * A `page` search param on its own: a positive integer, or `undefined` for
 * anything else (missing, non numeric, zero, negative, a decimal). Whether an
 * in range integer is actually within the page count is a fact only the query
 * knows, so that clamp happens in `queries.ts`, over this schema's result.
 */
const pageParamSchema = z.coerce.number().int().positive();

/** Parse a raw `page` search param; `undefined` reads as "not given". */
export function parsePageParam(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = pageParamSchema.safeParse(raw);

  return parsed.success ? parsed.data : undefined;
}

export const switchContactInput = z.object({ contactId: z.uuid() });

export type SwitchContactInput = z.infer<typeof switchContactInput>;
