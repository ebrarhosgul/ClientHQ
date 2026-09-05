/**
 * Point git at this repo's committed hooks.
 *
 * Hooks live in `.githooks/` and are committed, so everyone on the project gets
 * the same pre-commit checks. Git does not look there on its own: it reads
 * `.git/hooks/`, which is local and unshareable. One `core.hooksPath` setting
 * fixes that, and this script sets it on every `pnpm install` through the
 * `prepare` lifecycle.
 *
 * It is deliberately quiet and forgiving. A checkout with no git directory (a
 * tarball, some CI images) is not an error worth failing an install over, so it
 * says so and stops.
 */
import { spawnSync } from "node:child_process";

const HOOKS_PATH = ".githooks";

const git = (...args) =>
  spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const inRepo = git("rev-parse", "--is-inside-work-tree");

if (inRepo.status !== 0) {
  console.log("install-git-hooks: not a git checkout, skipping.");
  process.exit(0);
}

const current = git("config", "--get", "core.hooksPath").stdout?.trim();

if (current === HOOKS_PATH) {
  process.exit(0);
}

const set = git("config", "core.hooksPath", HOOKS_PATH);

if (set.status !== 0) {
  console.log(
    `install-git-hooks: could not set core.hooksPath (${set.stderr?.trim()}). ` +
      `Set it yourself with \`git config core.hooksPath ${HOOKS_PATH}\`.`,
  );
  process.exit(0);
}

console.log(`install-git-hooks: core.hooksPath -> ${HOOKS_PATH}`);
