import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `clienthq/no-raw-db-import`
 *
 * The load bearing rule of the whole design, made mechanical.
 *
 * Nothing outside the tenant scoping data access layer may import the raw
 * Drizzle handle from `src/db/client.ts`. A query against a tenant scoped table
 * with no `org_id` predicate leaks one agency's rows to another, and nothing in
 * the database stops it: spec 0001 is explicit that this scoping fails open.
 * Until this rule existed the guarantee was discipline; now a stray import fails
 * the build.
 *
 * The rule resolves each import specifier to a real absolute path before
 * comparing, so it catches every spelling of the same file: the `@/` alias, any
 * depth of relative path, with or without an extension.
 *
 * Where it does not apply is decided in `eslint.config.mjs`, not here, so every
 * exception is visible in one place and reviewable in a pull request.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root. This file lives at `tools/eslint/`, so root is two levels up. */
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "src");

/** The guarded module, without its extension. */
const GUARDED = path.join(SRC, "db", "client");

const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

/**
 * Turn an import specifier into an absolute path with no extension, or
 * `undefined` when it names a package rather than a file in this repo.
 *
 * @param {string} specifier the raw string from the import
 * @param {string} fromFile absolute path of the file doing the importing
 * @returns {string | undefined}
 */
function resolveSpecifier(specifier, fromFile) {
  const absolute = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith("./") || specifier.startsWith("../")
      ? path.resolve(path.dirname(fromFile), specifier)
      : undefined;

  if (absolute === undefined) return undefined;

  const extension = path.extname(absolute);

  return EXTENSIONS.includes(extension)
    ? absolute.slice(0, -extension.length)
    : absolute;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing the raw database handle outside the tenant scoping data access layer",
    },
    schema: [],
    messages: {
      rawDbImport:
        "Do not import the raw database handle from `src/db/client.ts` here. " +
        "A query with no `org_id` predicate leaks one agency's rows to another, " +
        "and nothing in the database stops it. Go through the tenant scoping " +
        "data access layer in `src/db/` instead.",
    },
  },

  create(context) {
    const filename = context.filename;

    /**
     * @param {import("estree").Node} node the node to report against
     * @param {import("estree").Node | null | undefined} source its source literal
     */
    const checkSource = (node, source) => {
      if (
        source === null ||
        source === undefined ||
        source.type !== "Literal" ||
        typeof source.value !== "string"
      ) {
        return;
      }

      if (resolveSpecifier(source.value, filename) === GUARDED) {
        context.report({ node, messageId: "rawDbImport" });
      }
    };

    return {
      // import { db } from "@/db/client"
      ImportDeclaration: (node) => checkSource(node, node.source),
      // export { db } from "@/db/client"  /  export * from "@/db/client"
      ExportNamedDeclaration: (node) => checkSource(node, node.source),
      ExportAllDeclaration: (node) => checkSource(node, node.source),
      // await import("@/db/client")
      ImportExpression: (node) => checkSource(node, node.source),
      // require("../src/db/client")
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        ) {
          checkSource(node, node.arguments[0]);
        }
      },
    };
  },
};

/** The local plugin, so the rule can be referenced as `clienthq/...`. */
export const clienthqPlugin = {
  meta: { name: "eslint-plugin-clienthq", version: "1.0.0" },
  rules: { "no-raw-db-import": rule },
};

export default rule;
