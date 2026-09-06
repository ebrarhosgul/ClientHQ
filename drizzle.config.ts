import { defineConfig } from "drizzle-kit";

import { loadEnvFiles } from "./src/lib/load-env-files";

loadEnvFiles();

/**
 * Migrations run against DIRECT_URL, the direct connection on port 5432, not the
 * pooler. Schema changes need a real session, and the transaction mode pooler
 * cannot give them one.
 *
 * Generated SQL is committed under `drizzle/` so every schema change is
 * reviewable in a pull request.
 */
export default defineConfig({
  schema: "./src/db/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? "",
  },
  strict: true,
  verbose: true,
});
