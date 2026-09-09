/**
 * covers: spec 0005 AC-10
 *
 * The slug helper is pure, so this is the cheap half of AC-10. The half that
 * needs a database, that both agency creation and the repair resolve against
 * `organizations.slug` and never against Clerk's stored value, is in
 * `src/db/tenant/provisioning.db.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { toSlug, uniqueSlug } from "./slug";

const NOTHING_TAKEN: ReadonlySet<string> = new Set();

describe("toSlug", () => {
  it.each([
    ["Northwind Studio", "northwind-studio"],
    ["NORTHWIND", "northwind"],
    ["  Northwind  ", "northwind"],
    ["Northwind & Co.", "northwind-co"],
    ["Northwind---Studio", "northwind-studio"],
    ["Studio 54", "studio-54"],
    ["-leading and trailing-", "leading-and-trailing"],
  ])("derives %j to %j", (name, expected) => {
    expect(toSlug(name)).toBe(expected);
  });

  it("drops accents rather than turning them into separators", () => {
    expect(toSlug("Ağaç Ajans")).toBe("agac-ajans");
    expect(toSlug("Café Créme")).toBe("cafe-creme");
  });

  it("falls back to a word when the name derives to nothing", () => {
    // The column is not null, and nothing in the product reads a slug, so any
    // stable word will do; the suffixing is what keeps it unique.
    expect(toSlug("+++")).toBe("agency");
    expect(toSlug("北京")).toBe("agency");
  });
});

describe("uniqueSlug", () => {
  it("uses the derived slug when nothing holds it", () => {
    expect(uniqueSlug("Northwind Studio", NOTHING_TAKEN)).toBe(
      "northwind-studio",
    );
  });

  it("suffixes past a taken slug", () => {
    expect(uniqueSlug("Northwind", new Set(["northwind"]))).toBe("northwind-2");
  });

  it("keeps suffixing past a run of taken slugs", () => {
    expect(
      uniqueSlug(
        "Northwind",
        new Set(["northwind", "northwind-2", "northwind-3"]),
      ),
    ).toBe("northwind-4");
  });

  it("takes a gap in the middle of the run rather than the end", () => {
    expect(uniqueSlug("Northwind", new Set(["northwind", "northwind-3"]))).toBe(
      "northwind-2",
    );
  });

  it("ignores taken slugs that belong to a different name", () => {
    expect(uniqueSlug("Northwind", new Set(["southwind", "southwind-2"]))).toBe(
      "northwind",
    );
  });

  it("always terminates: more candidates are generated than can be taken", () => {
    const taken = new Set(
      Array.from({ length: 50 }, (_, index) =>
        index === 0 ? "northwind" : `northwind-${index + 1}`,
      ),
    );

    expect(uniqueSlug("Northwind", taken)).toBe("northwind-51");
  });
});
