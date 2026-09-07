/**
 * @vitest-environment node
 *
 * covers: spec 0003 AC-12, AC-15 (the second door demands a reason and records
 * every grant)
 *
 * Who may *import* this module is a lint rule, proven in
 * `tools/eslint/tenant-isolation-config.test.mts`. What it does once imported is
 * proven here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./executor", () => ({
  pooledDb: async () => ({ marker: "the whole database" }),
}));

const { withSystemAccess } = await import("./system");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withSystemAccess", () => {
  it("hands the caller the unscoped handle", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const seen = await withSystemAccess(
      "stripe webhook: no session to resolve",
      async (db) => db,
    );

    expect(seen).toStrictEqual({ marker: "the whole database" });
  });

  it("records exactly one line, naming the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withSystemAccess(
      "daily cron: sweeps every organization",
      async () => undefined,
    );

    expect(warn).toHaveBeenCalledTimes(1);

    const [line] = warn.mock.calls[0] as [string];
    const parsed: unknown = JSON.parse(line);

    expect(parsed).toMatchObject({
      event: "tenant.system_access",
      operation: "withSystemAccess",
      reason: "daily cron: sweeps every organization",
    });
  });

  it("refuses a blank reason, so the grant is never anonymous", async () => {
    await expect(
      withSystemAccess("   ", async () => undefined),
    ).rejects.toThrow(/needs a reason/u);
  });
});
