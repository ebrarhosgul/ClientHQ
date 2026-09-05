// @vitest-environment node
import { ESLint, type Linter } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * covers: DW-3 (the raw database handle import rule actually fails a build)
 *
 * The wiring and the exemption list, not the rule itself.
 *
 * `no-raw-db-import.test.mts` proves the rule catches every spelling of the
 * guarded module. What it cannot prove is that the rule is switched on in this
 * project, that it is an error rather than a warning, or which files are let
 * through. `eslint.config.mjs` decides all three, deliberately, so every
 * exception sits in one reviewable place.
 *
 * These cases run the project's real config, so they are what would catch an
 * exemption widened by accident: `src/app/api/health/**` in place of the one
 * exact route would open a hole the rule's own tests would never see.
 */

const RAW_IMPORT = [
  'import { db } from "@/db/client";',
  "export const handle = db;",
  "",
].join("\n");

const RULE = "clienthq/no-raw-db-import";

let eslint: ESLint;

beforeAll(() => {
  // One instance for the file: loading the Next config is the slow part and it
  // does not change between cases.
  eslint = new ESLint({ cwd: process.cwd() });
});

/**
 * Lint a snippet as if it were saved at `filePath`.
 *
 * The file does not have to exist. Flat config picks its blocks by path, which
 * is exactly what is under test here, and linting text keeps the repo untouched.
 */
async function tenantFindings(
  code: string,
  filePath: string,
): Promise<readonly Linter.LintMessage[]> {
  const [result] = await eslint.lintText(code, {
    filePath,
    warnIgnored: false,
  });

  return (result?.messages ?? []).filter((message) => message.ruleId === RULE);
}

describe("the tenant isolation rule as this project configures it", () => {
  it("is switched on for ordinary application code", async () => {
    const findings = await tenantFindings(
      RAW_IMPORT,
      "src/invoices/queries.ts",
    );

    expect(findings).toHaveLength(1);
  });

  it("reports at error severity, because a warning would not fail a build", async () => {
    // DW-3 asks that a violation *fails* a build. `pnpm lint` exits 0 on
    // warnings, so severity is the whole difference between a gate and a note.
    const [finding] = await tenantFindings(
      RAW_IMPORT,
      "src/invoices/queries.ts",
    );

    expect(finding?.severity).toBe(2);
  });

  it("catches the import however it is spelled, through the real config", async () => {
    // The rule's own tests cover every spelling in isolation. This checks the
    // laundering routes survive the trip through the project config too.
    const dynamic = await tenantFindings(
      'export async function GET() {\n  const { db } = await import("@/db/client");\n  return db;\n}\n',
      "src/app/api/leak/route.ts",
    );
    const reExport = await tenantFindings(
      'export * from "@/db/client";\n',
      "src/invoices/index.ts",
    );

    expect(dynamic).toHaveLength(1);
    expect(reExport).toHaveLength(1);
  });
});

describe("the exemptions, which live in eslint.config.mjs and nowhere else", () => {
  it("lets the data access layer reach the handle it owns", async () => {
    // `src/db/` is where the handle lives and where feature 4 builds the
    // scoping helper every other query goes through.
    const findings = await tenantFindings(RAW_IMPORT, "src/db/scoped.ts");

    expect(findings).toEqual([]);
  });

  it("lets the two sanctioned connection checks through", async () => {
    const route = await tenantFindings(
      RAW_IMPORT,
      "src/app/api/health/db/route.ts",
    );
    const script = await tenantFindings(RAW_IMPORT, "scripts/db-check.ts");

    expect(route).toEqual([]);
    expect(script).toEqual([]);
  });

  it("exempts those two files exactly, not the folders they sit in", async () => {
    // The load bearing case. Both exemptions are written as exact paths on
    // purpose: a sibling route or a second script is a new decision about the
    // tenant boundary, so it has to be argued for in a pull request rather than
    // inherited from a neighbour.
    const siblingRoute = await tenantFindings(
      RAW_IMPORT,
      "src/app/api/health/other/route.ts",
    );
    const nestedRoute = await tenantFindings(
      RAW_IMPORT,
      "src/app/api/health/db/deep/route.ts",
    );
    const siblingScript = await tenantFindings(
      RAW_IMPORT,
      "scripts/backfill.ts",
    );

    expect(siblingRoute).toHaveLength(1);
    expect(nestedRoute).toHaveLength(1);
    expect(siblingScript).toHaveLength(1);
  });

  it("does not exempt a file merely because src/db appears in its path", async () => {
    const findings = await tenantFindings(
      RAW_IMPORT,
      "src/features/src/db/queries.ts",
    );

    expect(findings).toHaveLength(1);
  });
});
