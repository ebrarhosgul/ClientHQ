/**
 * The create and update input schemas for a client (spec 0006, AC-1, AC-2,
 * AC-3).
 *
 * These describe a form, not a row: every optional field arrives as `""` from
 * an untouched `<input>`, so each is preprocessed to `undefined` before its own
 * check runs. That is what lets a blank optional field succeed validation
 * instead of failing the company email check with an empty string.
 */
import { z } from "zod";

/** `""` (or whitespace only) becomes `undefined`, so a blank field is absent. */
function blankToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** An optional, trimmed string capped at `max` characters. */
function optionalText(max: number) {
  return z.preprocess(
    blankToUndefined,
    z.string().trim().max(max, `Use ${max} characters or fewer.`).optional(),
  );
}

/** Mirrors the `clients_company_email_lowercase_check` constraint. */
const optionalCompanyEmail = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "Use 320 characters or fewer.")
    .pipe(z.email("Enter a valid email address."))
    .optional(),
);

/**
 * The same parsed value as `field`, but a blank input becomes an explicit
 * `null` instead of `undefined`. `updateClient` sends its whole patch
 * straight to Drizzle's `.set()`, which silently drops any key whose value
 * is `undefined` — so on the update schema a blank field has to parse to
 * something that actually reaches the `SET` clause and clears the column.
 * `createClient` doesn't need this: an omitted key on insert already leaves
 * the column at its default of `null`.
 */
function clearable<T>(field: z.ZodType<T | undefined>): z.ZodType<T | null> {
  return field.transform((value) => value ?? null);
}

/** `clients.id` is a uuid column; any other shape resolves not found rather than reaching the database as a malformed query (AC-11). */
export const clientId = z.uuid();

const clientFields = {
  name: z
    .string()
    .trim()
    .min(1, "Enter a client name.")
    .max(200, "Use 200 characters or fewer."),
  companyEmail: optionalCompanyEmail,
  phone: optionalText(50),
  industry: optionalText(200),
  notes: optionalText(5000),
  billingAddressLine1: optionalText(200),
  billingAddressLine2: optionalText(200),
  billingCity: optionalText(200),
  billingRegion: optionalText(200),
  billingPostalCode: optionalText(20),
  billingCountry: optionalText(200),
};

export const createClientInput = z.object(clientFields);

export const updateClientInput = z.object({
  id: clientId,
  name: clientFields.name,
  companyEmail: clearable(clientFields.companyEmail),
  phone: clearable(clientFields.phone),
  industry: clearable(clientFields.industry),
  notes: clearable(clientFields.notes),
  billingAddressLine1: clearable(clientFields.billingAddressLine1),
  billingAddressLine2: clearable(clientFields.billingAddressLine2),
  billingCity: clearable(clientFields.billingCity),
  billingRegion: clearable(clientFields.billingRegion),
  billingPostalCode: clearable(clientFields.billingPostalCode),
  billingCountry: clearable(clientFields.billingCountry),
});

export type CreateClientInput = z.infer<typeof createClientInput>;
export type UpdateClientInput = z.infer<typeof updateClientInput>;
