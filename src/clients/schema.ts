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
  id: z.string().min(1),
  ...clientFields,
});

export type CreateClientInput = z.infer<typeof createClientInput>;
export type UpdateClientInput = z.infer<typeof updateClientInput>;
