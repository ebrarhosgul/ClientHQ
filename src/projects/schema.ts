/**
 * The create, update and transition input schemas for a project (spec 0010,
 * AC-2).
 *
 * The create and update schemas describe a form, not a row, the same way
 * `src/clients/schema.ts` does: an optional field arrives as `""` from an
 * untouched `<input>`, so it is preprocessed to `undefined` before its own
 * check runs.
 */
import { z } from "zod";

import { PROJECT_STATUSES } from "@/db/schema";

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

/**
 * `YYYY-MM-DD`, and a real calendar day. Matching the pattern is not enough
 * on its own: `2026-02-30` matches it and is not a real day, so the string is
 * round-tripped through `Date.UTC` and compared back to itself (spec 0010,
 * Value sourcing).
 */
function isRealCalendarDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

  if (match === null) {
    return false;
  }

  const [, year, month, day] = match;
  const asDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );

  return asDate.toISOString().slice(0, 10) === value;
}

const optionalDueDate = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => value === undefined || isRealCalendarDay(value),
      "Enter a real date.",
    ),
);

/**
 * The same parsed value as `field`, but a blank input becomes an explicit
 * `null` instead of `undefined`, so it reaches Drizzle's `.set()` and clears
 * the column rather than being silently dropped (mirrors
 * `src/clients/schema.ts`'s `clearable`).
 */
function clearable<T>(field: z.ZodType<T | undefined>): z.ZodType<T | null> {
  return field.transform((value) => value ?? null);
}

/** `projects.id` is a uuid column; any other shape resolves not found (AC-15). */
export const projectId = z.uuid();

const name = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(200, "Use 200 characters or fewer.");

const description = optionalText(5000);

export const createProjectInput = z.object({
  clientId: z.uuid("Choose a client."),
  name,
  description,
  dueDate: optionalDueDate,
});

export const updateProjectInput = z.object({
  id: projectId,
  name,
  description: clearable(description),
  dueDate: clearable(optionalDueDate),
});

export const transitionProjectInput = z.object({
  id: projectId,
  from: z.enum(PROJECT_STATUSES),
  to: z.enum(PROJECT_STATUSES),
});

export type CreateProjectInput = z.infer<typeof createProjectInput>;
export type UpdateProjectInput = z.infer<typeof updateProjectInput>;
export type TransitionProjectInput = z.infer<typeof transitionProjectInput>;
