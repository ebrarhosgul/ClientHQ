/**
 * @vitest-environment node
 *
 * covers: spec 0017 AC-5 (the skip branch, which needs no database)
 */
import { describe, expect, it } from "vitest";

import { abandonedUploadsSweep } from "./abandoned-sweep";

/** A database handle that fails loudly on any property access. */
const untouchableDb = new Proxy(
  {},
  {
    get: (_, property) => {
      throw new Error(`the database was touched (${String(property)})`);
    },
  },
);

describe("abandonedUploadsSweep", () => {
  it("skips without touching the database when no storage is bound", async () => {
    const report = await abandonedUploadsSweep(undefined).run({
      db: untouchableDb as never,
      todayUtc: "2026-06-15",
      now: new Date(),
    });

    expect(report).toEqual({
      outcome: "skipped",
      reason: "storage not configured",
    });
  });
});
