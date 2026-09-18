/**
 * @vitest-environment node
 *
 * covers: spec 0018 AC-7
 *
 * The fail-open path: when the store throws, `consume` never does. It
 * returns `allowed` and logs one `rate_limit.skipped` line, so the counter
 * failing is never the reason a limited action fails. Mocked, because AC-7
 * asks for behaviour a live database cannot be made to produce on demand;
 * the atomic upsert itself is proven against real PostgreSQL in
 * `rate-limit.db.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pooledDb: vi.fn() }));

vi.mock("./executor", () => ({ pooledDb: state.pooledDb }));

const { consume } = await import("./rate-limit");
const { UPLOAD } = await import("@/rate-limit/policies");

const warned: string[] = [];

beforeEach(() => {
  warned.length = 0;
  state.pooledDb.mockReset();
  vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    warned.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function logged(): Record<string, unknown>[] {
  return warned.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

describe("consume, the store failing", () => {
  it("returns allowed and logs rate_limit.skipped rather than throwing (AC-7)", async () => {
    const outage = new Error("connection refused");
    outage.name = "ConnectionError";
    state.pooledDb.mockRejectedValue(outage);

    const verdict = await consume(
      { kind: "org", id: "org-1" },
      UPLOAD,
      new Date("2026-06-15T14:00:00.000Z"),
    );

    expect(verdict).toStrictEqual({ allowed: true });
    expect(logged()).toStrictEqual([
      expect.objectContaining({
        event: "rate_limit.skipped",
        subject: "org:org-1",
        action: "upload",
        errorName: "ConnectionError",
      }),
    ]);
  });

  it("carries the error's own name, not a hardcoded one", async () => {
    const timeout = new Error("too slow");
    timeout.name = "TimeoutError";
    state.pooledDb.mockRejectedValue(timeout);

    await consume(
      { kind: "user", id: "user-1" },
      UPLOAD,
      new Date("2026-06-15T14:00:00.000Z"),
    );

    expect(logged()).toStrictEqual([
      expect.objectContaining({ errorName: "TimeoutError" }),
    ]);
  });
});
