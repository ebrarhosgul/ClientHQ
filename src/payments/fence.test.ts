// @vitest-environment node

/**
 * covers: spec 0007 AC-20
 *
 * The fence, checked against the repository rather than against the config.
 *
 * `tools/eslint/tenant-isolation-config.test.mts` already proves the ESLint
 * rule is switched on, at error severity, and exempts exactly the files spec
 * 0003 names. This is the other half, and the half this feature could have
 * broken: that the code actually written keeps the door shut. Spec 0007 opened
 * the Stripe route's exemption, and the temptation while building a webhook is
 * to reach for unscoped access from a helper beside it, which ESLint would
 * catch, or to widen the list, which it would not.
 *
 * So: one importer, and the exemption list is not this feature's to grow.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastGlob from "fast-glob";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * The files allowed to reach the second door, in the order spec 0003 lists
 * them: two provider webhooks, the daily cron, and the door's own test. Only
 * the first of the four exists today; the rest are later features.
 */
const ALLOWED = [
  "src/app/api/webhooks/stripe/route.ts",
  "src/app/api/webhooks/clerk/route.ts",
  "src/app/api/cron/daily/route.ts",
  "src/db/tenant/system.test.ts",
];

/**
 * Every spelling of the guarded module the ESLint rule itself catches: the `@/`
 * alias or any relative depth, static or dynamic. The tenant layer's own test
 * reaches it through `await import("./system")`, so matching only
 * `from "..."` would quietly let a dynamic import past this check.
 */
const SPECIFIER = String.raw`(?:@\/db\/tenant\/system|(?:\.\.?\/)+system)`;

const IMPORTS_SYSTEM = new RegExp(
  String.raw`(?:from\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']${SPECIFIER}["']`,
);

describe("the second door stays shut", () => {
  it("is imported only by the routes the exemption list names", async () => {
    const files = await fastGlob("src/**/*.{ts,tsx}", {
      cwd: ROOT,
      // This file spells the guarded specifier out in order to look for it, so
      // scanning itself would always find one importer that is not one.
      ignore: ["src/payments/fence.test.ts"],
    });

    const importers = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(path.join(ROOT, file), "utf8");

          return IMPORTS_SYSTEM.test(source) ? file : undefined;
        }),
      )
    ).filter((file): file is string => file !== undefined);

    expect(importers.sort()).toEqual([
      "src/app/api/webhooks/stripe/route.ts",
      "src/db/tenant/system.test.ts",
    ]);
    // And every one of them is on the list, which is the claim that matters if
    // a later feature adds the second and third.
    for (const importer of importers) {
      expect(ALLOWED).toContain(importer);
    }
  });
});
