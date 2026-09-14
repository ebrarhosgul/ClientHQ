/**
 * The input schemas for the five deliverable Server Actions (spec 0011,
 * AC-2).
 *
 * `name` is the one field with real shape rules: a browser never puts a
 * control character or `/`, `\` or `"` into `File.name`, but nothing stops a
 * crafted request from trying, and `/` or `\` in a stored name would look
 * like a path and `"` would break the download's `Content-Disposition`
 * header (belt and braces alongside `r2.ts`'s own escaping).
 */
import { z } from "zod";

import { ALLOWED_CONTENT_TYPES, MAX_UPLOAD_BYTES } from "./file-rules";

/** `deliverables.id` is a uuid column; any other shape resolves not found. */
export const deliverableId = z.uuid();

const CONTROL_OR_FORBIDDEN = /[\x00-\x1f\x7f/\\"]/u;

export const deliverableName = z
  .string()
  .trim()
  .min(1, "Enter a file name.")
  .max(255, "Use 255 characters or fewer.")
  .refine(
    (value) => !CONTROL_OR_FORBIDDEN.test(value),
    'A file name cannot contain control characters, "/", "\\" or \'"\'.',
  );

export const deliverableContentType = z.enum(
  ALLOWED_CONTENT_TYPES,
  "That file type is not supported.",
);

export const deliverableSizeBytes = z
  .number()
  .int()
  .min(1, "The file is empty.")
  .max(MAX_UPLOAD_BYTES, "That file is larger than the 100 MB limit.");

export const requestUploadInput = z.object({
  projectId: z.uuid(),
  name: deliverableName,
  contentType: deliverableContentType,
  sizeBytes: deliverableSizeBytes,
});

export const confirmUploadInput = z.object({ deliverableId });

export const abandonUploadInput = z.object({ deliverableId });

export const setDeliverableVisibilityInput = z.object({
  deliverableId,
  visibleToClient: z.boolean(),
});

export const deleteDeliverableInput = z.object({ deliverableId });

export type RequestUploadInput = z.infer<typeof requestUploadInput>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadInput>;
export type AbandonUploadInput = z.infer<typeof abandonUploadInput>;
export type SetDeliverableVisibilityInput = z.infer<
  typeof setDeliverableVisibilityInput
>;
export type DeleteDeliverableInput = z.infer<typeof deleteDeliverableInput>;
