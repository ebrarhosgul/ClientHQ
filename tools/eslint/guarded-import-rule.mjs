import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A rule factory for "this module may only be imported from certain places".
 *
 * Two modules in this repo are guarded that way: the raw database handle, and
 * the unscoped system access door. Both need the same behaviour, which is to
 * resolve every import specifier to a real absolute path before comparing, so
 * the check catches every spelling of the same file: the `@/` alias, any depth
 * of relative path, with or without an extension, static or dynamic, plus a
 * re-export used to launder it.
 *
 * *Where* each one does not apply is decided in `eslint.config.mjs`, never
 * here, so every exception sits in one reviewable place.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root. This file lives at `tools/eslint/`, so root is two levels up. */
const ROOT = path.resolve(HERE, "..", "..");
const SRC = path.join(ROOT, "src");

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
export function resolveSpecifier(specifier, fromFile) {
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

/**
 * Build a rule that reports any import of one guarded module.
 *
 * @param {object} options
 * @param {string[]} options.guarded the guarded module's path segments under `src/`, without an extension
 * @param {string} options.description what the rule is for
 * @param {string} options.messageId the id the report carries
 * @param {string} options.message what the reader is told, and what to do instead
 * @returns {import("eslint").Rule.RuleModule}
 */
export function createGuardedImportRule({
  guarded,
  description,
  messageId,
  message,
}) {
  const guardedPath = path.join(SRC, ...guarded);

  return {
    meta: {
      type: "problem",
      docs: { description },
      schema: [],
      messages: { [messageId]: message },
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

        if (resolveSpecifier(source.value, filename) === guardedPath) {
          context.report({ node, messageId });
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
}
