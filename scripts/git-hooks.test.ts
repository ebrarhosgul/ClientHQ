/**
 * @vitest-environment node
 *
 * covers: F-1 (a pre-commit hook runs lint, format and typecheck on staged files)
 *
 * Tests for the local commit gate: the installer that points git at the
 * committed hooks, and the properties of the hook itself that decide whether it
 * runs at all.
 *
 * Everything here happens inside a throwaway repository in the system temp
 * directory, with global and system git config switched off, so a run cannot
 * touch this checkout and cannot be swayed by whatever the person running it
 * has configured for themselves.
 *
 * What the hook actually reports on staged files is not tested here. Doing that
 * honestly needs a repository with this project's dependencies, its ESLint
 * config and its Next types, at which point the test is a slower copy of CI.
 * Those cases stay manual in docs/verify/0002-coding-standards-and-tooling.md.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

const ROOT = process.cwd();
const INSTALLER = path.resolve(ROOT, "scripts/install-git-hooks.mjs");
const PRE_COMMIT = path.resolve(ROOT, ".githooks/pre-commit");

/** Real path, because git compares ceiling directories literally. */
const TMP_ROOT = fs.realpathSync(os.tmpdir());

/**
 * Git with nothing inherited: no global config, no system config, and no
 * searching upwards past the temp directory. Without the ceiling, a temp
 * directory that happens to sit inside someone's repository would look like a
 * git checkout to the "not a git checkout" case.
 */
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CEILING_DIRECTORIES: TMP_ROOT,
} as NodeJS.ProcessEnv;

const scratchDirs: string[] = [];

function scratchDir(): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(TMP_ROOT, "clienthq-hooks-")),
  );
  scratchDirs.push(dir);
  return dir;
}

async function git(
  args: readonly string[],
  cwd: string,
): Promise<{ readonly code: number; readonly stdout: string }> {
  try {
    const { stdout } = await run("git", [...args], { cwd, env: ISOLATED_ENV });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "" };
  }
}

async function scratchRepo(): Promise<string> {
  const dir = scratchDir();
  await git(["init", "--quiet"], dir);
  return dir;
}

type Outcome = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runIn(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(command, [...args], {
      cwd,
      env: ISOLATED_ENV,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const installInto = (cwd: string) => runIn("node", [INSTALLER], cwd);
const hooksPathIn = async (cwd: string) =>
  (await git(["config", "--get", "core.hooksPath"], cwd)).stdout.trim();

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("install-git-hooks, which pnpm install runs through prepare", () => {
  it("points a fresh checkout at the committed hooks", async () => {
    // Git reads `.git/hooks/`, which is local and cannot be shared. Without
    // this one setting the committed hooks are decoration.
    const repo = await scratchRepo();

    const result = await installInto(repo);

    expect(result.code).toBe(0);
    expect(await hooksPathIn(repo)).toBe(".githooks");
  });

  it("says what it did, so a fresh clone can see the gate is on", async () => {
    const repo = await scratchRepo();

    const result = await installInto(repo);

    expect(result.stdout).toContain(
      "install-git-hooks: core.hooksPath -> .githooks",
    );
  });

  it("stays quiet on every install after the first", async () => {
    // This runs on every `pnpm install`. A line of output each time is noise
    // that teaches people to skim past install logs.
    const repo = await scratchRepo();
    await installInto(repo);

    const second = await installInto(repo);

    expect(second.code).toBe(0);
    expect(second.stdout.trim()).toBe("");
    expect(await hooksPathIn(repo)).toBe(".githooks");
  });

  it("repairs a hooksPath that points somewhere else", async () => {
    const repo = await scratchRepo();
    await git(["config", "core.hooksPath", ".other-hooks"], repo);

    await installInto(repo);

    expect(await hooksPathIn(repo)).toBe(".githooks");
  });

  it("skips a checkout that is not a git repository, without failing the install", async () => {
    // A tarball or some CI images have no .git directory. Exiting non zero
    // there would fail `pnpm install` over something that does not matter.
    const notARepo = scratchDir();

    const result = await installInto(notARepo);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("not a git checkout, skipping.");
  });

  it("writes no git config when there is no repository to write it to", async () => {
    const notARepo = scratchDir();

    await installInto(notARepo);

    expect(fs.existsSync(path.join(notARepo, ".git"))).toBe(false);
  });
});

describe("the pre-commit hook itself", () => {
  it("is committed with its executable bit set", async () => {
    // Git skips a hook it cannot execute, silently. Locally chmod hides this;
    // the mode recorded in the index is what a fresh clone actually gets.
    const { stdout } = await git(
      ["ls-files", "--stage", ".githooks/pre-commit"],
      ROOT,
    );

    expect(stdout.startsWith("100755 ")).toBe(true);
  });

  it("is valid POSIX shell, so it fails commits for real reasons only", async () => {
    // A syntax error here refuses every commit with a message about the hook
    // rather than about the code.
    const result = await runIn("sh", ["-n", PRE_COMMIT], ROOT);

    expect(result.code).toBe(0);
  });

  it("passes straight through when nothing is staged", async () => {
    // An empty commit, or a commit of deletions only, has nothing to check.
    // This path exits before it reaches any tool, which is why it can be
    // exercised in a repository with no dependencies installed.
    const repo = await scratchRepo();

    const result = await runIn("sh", [PRE_COMMIT], repo);

    expect(result.code).toBe(0);
  });
});
