import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Unit and integration tests. Playwright owns `e2e/`, so it is excluded here:
 * running a browser spec under Vitest fails in a way that looks like a broken
 * test rather than the wrong runner.
 *
 * `resolve.tsconfigPaths` teaches Vite the `@/*` alias from tsconfig.json, so
 * tests import modules exactly the way the application does.
 *
 * jsdom is the default because component tests need a DOM. Files that must run
 * on real Node (the route handler, the script, the plain modules) opt out with a
 * `@vitest-environment node` docblock at the top of the file.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    // Each file gets its own module registry. These tests reset modules and
    // touch process.env and globalThis, which would otherwise leak sideways.
    isolate: true,
  },
});
