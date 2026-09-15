/**
 * @vitest-environment node
 *
 * Pins `DOWNLOAD_PAGE_TOKENS` to `src/app/globals.css`, the way
 * `src/ui/contrast.test.ts` pins the measured contrast ratios: reads the
 * real stylesheet rather than a copy of it, so editing a token is what runs
 * this. `src/ui/token-discipline.test.ts` does not scan `src/deliverables/`,
 * so this file is the only thing that notices these literals drifting from
 * the tokens they were copied from.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractTokenBlock } from "@/ui/contrast";

import { DOWNLOAD_PAGE_TOKENS } from "./download-error-page";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const light = extractTokenBlock(css, "tokens:light");
const dark = extractTokenBlock(css, "tokens:dark-explicit");

describe("DOWNLOAD_PAGE_TOKENS", () => {
  it.each(Object.entries(DOWNLOAD_PAGE_TOKENS.light))(
    "%s matches globals.css's light palette",
    (name, value) => {
      expect(value).toBe(light[name]);
    },
  );

  it.each(Object.entries(DOWNLOAD_PAGE_TOKENS.dark))(
    "%s matches globals.css's dark palette",
    (name, value) => {
      expect(value).toBe(dark[name]);
    },
  );
});
