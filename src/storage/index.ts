/**
 * The one way the rest of the product reaches object storage (spec 0011).
 *
 * `objectStorage()` is a function, not a top level constant, for the same
 * reason `env()` is: a build must never need real credentials, and neither
 * `r2Storage`'s functions nor this one touch the network or construct a
 * client until actually called.
 */
import { env } from "@/lib/env";

import { r2Storage } from "./r2";
import type { ObjectStorage } from "./port";

export type {
  ObjectStorage,
  HeadResult,
  PresignGetArgs,
  PresignPutArgs,
} from "./port";
export type { FakeObject, FakeObjectStorage } from "./fake";

/**
 * Are all four R2 variables set?
 *
 * Read through `env()`, so a production process missing one has already
 * failed at parse time. Outside production this is what every deliverable
 * Server Action and the download route check first (AC-18).
 */
export function isStorageConfigured(): boolean {
  const value = env();

  return (
    value.R2_ACCOUNT_ID !== undefined &&
    value.R2_ACCESS_KEY_ID !== undefined &&
    value.R2_SECRET_ACCESS_KEY !== undefined &&
    value.R2_BUCKET !== undefined
  );
}

/** The real object store, or `undefined` when it is not configured. */
export function objectStorage(): ObjectStorage | undefined {
  return isStorageConfigured() ? r2Storage : undefined;
}
