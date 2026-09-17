/**
 * covers: spec 0017 AC-3
 *
 * Whatever is wired so far has to be a prefix of `SWEEP_ORDER`, the fixed
 * order AC-3 requires: a later milestone appends, it never reorders or skips
 * ahead.
 */
import { describe, expect, it } from "vitest";

import { DAILY_SWEEPS } from "./daily";
import { SWEEP_ORDER } from "./sweep";

describe("DAILY_SWEEPS", () => {
  it("is a prefix of the fixed sweep order", () => {
    const names = DAILY_SWEEPS.map((sweep) => sweep.name);

    expect(names).toEqual(SWEEP_ORDER.slice(0, names.length));
  });

  it("has no duplicate names", () => {
    const names = DAILY_SWEEPS.map((sweep) => sweep.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
