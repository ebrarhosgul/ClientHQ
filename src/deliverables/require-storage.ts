/**
 * The one check every deliverable Server Action runs before anything else
 * (spec 0011, AC-18): with the four `R2_*` variables absent, a write refuses
 * immediately rather than reaching a row or a signing call that would fail
 * anyway with a confusing error.
 */
import { tenantActionError } from "@/db/tenant";
import { objectStorage, type ObjectStorage } from "@/storage";

export const STORAGE_NOT_CONFIGURED_MESSAGE =
  "File storage is not configured for this environment";

/** The configured store, or a `conflict` refusal with the fixed message. */
export function requireConfiguredStorage(): ObjectStorage {
  const storage = objectStorage();

  if (storage === undefined) {
    throw tenantActionError({
      code: "conflict",
      message: STORAGE_NOT_CONFIGURED_MESSAGE,
    });
  }

  return storage;
}
