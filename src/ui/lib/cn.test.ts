import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("joins plain class names with a space", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values, so a conditional class can be written inline", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("flattens arrays and objects the way clsx does", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });

  it("lets a later conflicting Tailwind utility win instead of both landing", () => {
    // The whole reason this wraps tailwind-merge: a caller's override should
    // beat a component's own default, not just tack on beside it.
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("leaves unrelated utilities alone when merging", () => {
    expect(cn("px-4 text-sm", "px-6")).toBe("text-sm px-6");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
