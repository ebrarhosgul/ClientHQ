// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readConsent } from "./consent-state";

describe("readConsent (spec 0019, AC-17)", () => {
  it("reads the two stored choices", () => {
    expect(readConsent("accepted")).toBe("accepted");
    expect(readConsent("declined")).toBe("declined");
  });

  it("reads a missing or malformed cookie as undecided", () => {
    expect(readConsent(undefined)).toBe("undecided");
    expect(readConsent("")).toBe("undecided");
    expect(readConsent("yes")).toBe("undecided");
    expect(readConsent("Accepted")).toBe("undecided");
    expect(readConsent("undecided")).toBe("undecided");
  });
});
