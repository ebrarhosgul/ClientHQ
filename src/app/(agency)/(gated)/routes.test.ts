/**
 * @vitest-environment node
 *
 * covers: spec 0008 AC-4
 *
 * The gate works by where a page sits, so the route tree is the contract.
 * Checked against the file system, not against a list typed here twice:
 * every section the sidebar links to is either inside `(gated)` or one of
 * the two the spec keeps outside so a lapsed agency can always pay. Moving
 * `billing` in would lock an agency out of the page that lets it back in;
 * adding a section outside would ship an ungated page. Both fail here.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_NAV } from "@/ui/shell/navigation";

const GATED_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENCY_DIR = path.resolve(GATED_DIR, "..");

/** Reachable at every level, by design (spec 0008, AC-4). */
const OUTSIDE_THE_GATE = ["/billing", "/settings"];

async function exists(dir: string): Promise<boolean> {
  try {
    await access(dir);

    return true;
  } catch {
    return false;
  }
}

describe("the gated route group", () => {
  it("holds every sidebar section except billing and settings", async () => {
    for (const { href } of ALL_NAV) {
      const segment = href.slice(1);
      const inGate = await exists(path.join(GATED_DIR, segment));
      const outside = await exists(path.join(AGENCY_DIR, segment));

      if (OUTSIDE_THE_GATE.includes(href)) {
        expect({ href, inGate, outside }).toStrictEqual({
          href,
          inGate: false,
          outside: true,
        });
      } else {
        expect({ href, inGate, outside }).toStrictEqual({
          href,
          inGate: true,
          outside: false,
        });
      }
    }
  });

  it("has the layout that applies the gate", async () => {
    await expect(exists(path.join(GATED_DIR, "layout.tsx"))).resolves.toBe(
      true,
    );
  });

  it("sits under the agency error boundary, so a failed read renders inside the shell (AC-12)", async () => {
    await expect(exists(path.join(AGENCY_DIR, "error.tsx"))).resolves.toBe(
      true,
    );
  });
});
