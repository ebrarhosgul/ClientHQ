/**
 * @vitest-environment node
 *
 * covers: spec 0019 AC-21
 *
 * `after()` from `next/server` has no request to attach to outside a real
 * request (a unit test included), and throws when called that way. This is
 * the one place that matters: the task still has to run.
 */
import { describe, expect, it, vi } from "vitest";

import { afterResponse } from "./after-response";

describe("afterResponse", () => {
  it("runs the task even with no request to schedule it on", async () => {
    const task = vi.fn();

    afterResponse(task);

    await vi.waitFor(() => {
      expect(task).toHaveBeenCalledTimes(1);
    });
  });

  it("runs an async task through to completion", async () => {
    let ran = false;

    afterResponse(async () => {
      await Promise.resolve();
      ran = true;
    });

    await vi.waitFor(() => {
      expect(ran).toBe(true);
    });
  });

  it("never throws into its caller when the task rejects", async () => {
    const task = vi.fn().mockRejectedValue(new Error("boom"));

    expect(() => afterResponse(task)).not.toThrow();

    await vi.waitFor(() => {
      expect(task).toHaveBeenCalledTimes(1);
    });
  });

  it("never throws into its caller when the task throws synchronously", () => {
    expect(() =>
      afterResponse(() => {
        throw new Error("boom");
      }),
    ).not.toThrow();
  });
});
