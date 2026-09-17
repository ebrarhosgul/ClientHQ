/**
 * covers: spec 0014 AC-6, AC-8, AC-9, AC-17
 */
import { describe, expect, it } from "vitest";

import { parsePageParam } from "./schema";

describe("parsePageParam", () => {
  it("reads a positive integer", () => {
    expect(parsePageParam("2")).toBe(2);
  });

  it("reads undefined as not given", () => {
    expect(parsePageParam(undefined)).toBeUndefined();
  });

  it("reads zero, negative, non numeric and decimal values as not given", () => {
    expect(parsePageParam("0")).toBeUndefined();
    expect(parsePageParam("-1")).toBeUndefined();
    expect(parsePageParam("abc")).toBeUndefined();
    expect(parsePageParam("1.5")).toBeUndefined();
  });
});
