/**
 * covers: spec 0017 AC-1
 */
import { describe, expect, it } from "vitest";

import { isAuthorized } from "./secret";

const SECRET = "a-very-real-secret-value-32-chars";

describe("isAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing header", () => {
    expect(isAuthorized(null, SECRET)).toBe(false);
  });

  it("refuses a wrong token", () => {
    expect(isAuthorized("Bearer not-the-secret", SECRET)).toBe(false);
  });

  it("refuses a token of a different length", () => {
    expect(isAuthorized(`Bearer ${SECRET}-and-more`, SECRET)).toBe(false);
    expect(isAuthorized("Bearer short", SECRET)).toBe(false);
  });

  it("refuses a different scheme", () => {
    expect(isAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("refuses an empty header", () => {
    expect(isAuthorized("", SECRET)).toBe(false);
  });
});
