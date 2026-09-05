/**
 * Prettier owns layout; ESLint owns everything else. `eslint-config-prettier`
 * sits last in `eslint.config.mjs` and switches off every ESLint rule that would
 * argue with the settings below, so the two never fight over the same line.
 *
 * These values are Prettier's own defaults. They are written out anyway because
 * the scaffold was already formatted this way, and a default that is invisible
 * is a default nobody can check.
 *
 * @type {import("prettier").Config}
 */
const config = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 80,
  tabWidth: 2,
  arrowParens: "always",
  endOfLine: "lf",
};

export default config;
