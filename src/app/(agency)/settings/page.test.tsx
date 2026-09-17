/**
 * @vitest-environment node
 *
 * covers: spec 0015 AC-15
 *
 * `/settings` is reserved: the sidebar can link to it, but it hands off to
 * the route group's own not found page rather than pretending the section
 * exists.
 */
import { describe, expect, it } from "vitest";

import SettingsPlaceholder from "./page";

describe("SettingsPlaceholder", () => {
  it("calls not found rather than rendering a page", () => {
    expect(() => SettingsPlaceholder()).toThrow();
  });
});
