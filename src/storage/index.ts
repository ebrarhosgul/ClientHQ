/**
 * The one way the rest of the product reaches object storage (spec 0011).
 *
 * `objectStorage()` is a function, not a top level constant, for the same
 * reason `env()` is: a build must never need real credentials, and neither
 * `r2Storage`'s functions nor this one touch the network or construct a
 * client until actually called.
 */
import { isR2Configured } from "@/lib/env";

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
 * Delegates to `isR2Configured`, which reads `process.env` directly instead
 * of through `env()`: the download route calls this before it knows whether
 * Clerk is configured (spec 0011, AC-18), and `env()` throws unconditionally
 * when `CLERK_SECRET_KEY` is missing. This is what every deliverable Server
 * Action and the download route check first.
 */
export function isStorageConfigured(): boolean {
  return isR2Configured();
}

/** The real object store, or `undefined` when it is not configured. */
export function objectStorage(): ObjectStorage | undefined {
  return isStorageConfigured() ? r2Storage : undefined;
}
