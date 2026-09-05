/**
 * @vitest-environment node
 *
 * Tests for the env file loader the scripts outside Next.js use.
 *
 * These use real files in a real temporary directory rather than a mocked
 * dotenv. The whole point of the module is a precedence rule (.env.local beats
 * .env), and asserting that dotenv was called with a particular array proves
 * only that the call was written, not that the rule holds.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvFiles } from "./load-env-files";

const KEY = "CLIENTHQ_LOAD_ENV_FILES_PROBE";
const OTHER_KEY = "CLIENTHQ_LOAD_ENV_FILES_OTHER";

let workDir: string;
let originalCwd: string;

function writeEnvFile(name: string, contents: string) {
  writeFileSync(join(workDir, name), contents, "utf8");
}

beforeEach(() => {
  originalCwd = process.cwd();
  workDir = mkdtempSync(join(tmpdir(), "clienthq-env-"));
  process.chdir(workDir);
  delete process.env[KEY];
  delete process.env[OTHER_KEY];
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  delete process.env[KEY];
  delete process.env[OTHER_KEY];
});

describe("loadEnvFiles", () => {
  it("reads values out of .env", () => {
    writeEnvFile(".env", `${KEY}=from-env\n`);

    loadEnvFiles();

    expect(process.env[KEY]).toBe("from-env");
  });

  it("reads values out of .env.local", () => {
    writeEnvFile(".env.local", `${KEY}=from-env-local\n`);

    loadEnvFiles();

    expect(process.env[KEY]).toBe("from-env-local");
  });

  it("lets .env.local win where both files set the same key", () => {
    // This is the whole reason the module exists. Next.js resolves it this way,
    // and the migration tooling has to agree or configuration splits in half.
    writeEnvFile(".env", `${KEY}=from-env\n`);
    writeEnvFile(".env.local", `${KEY}=from-env-local\n`);

    loadEnvFiles();

    expect(process.env[KEY]).toBe("from-env-local");
  });

  it("still picks up keys that only .env defines", () => {
    writeEnvFile(".env", `${KEY}=from-env\n${OTHER_KEY}=only-in-env\n`);
    writeEnvFile(".env.local", `${KEY}=from-env-local\n`);

    loadEnvFiles();

    expect(process.env[KEY]).toBe("from-env-local");
    expect(process.env[OTHER_KEY]).toBe("only-in-env");
  });

  it("leaves a value already set in the real environment alone", () => {
    // A value passed on the command line or set by the host beats a file.
    process.env[KEY] = "from-the-shell";
    writeEnvFile(".env", `${KEY}=from-env\n`);
    writeEnvFile(".env.local", `${KEY}=from-env-local\n`);

    loadEnvFiles();

    expect(process.env[KEY]).toBe("from-the-shell");
  });

  it("does nothing and does not throw when neither file exists", () => {
    expect(() => loadEnvFiles()).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });
});
