/**
 * Prove the database connection works end to end: this app, through Drizzle,
 * through the Supabase transaction pooler, to Postgres and back.
 *
 * Run it with `pnpm db:check`. It reports the server version and the current
 * database, then exits. It writes nothing.
 */
import { sql } from "drizzle-orm";

import { loadEnvFiles } from "../src/lib/load-env-files";

loadEnvFiles();

async function main() {
  // Imported inside the function, after the env files are loaded: the client
  // validates its environment the moment it is imported. Importing at the top
  // of the file would also make this an async module, which tsx cannot require.
  const { db } = await import("../src/db/client");

  const started = Date.now();

  // postgres.js hands these back as strings, not as a Date. Do not annotate
  // `now` as a Date here: it type checks, then fails at runtime.
  const rows = await db.execute<{
    version: string;
    database: string;
    now: string;
  }>(sql`select version() as version, current_database() as database, now() as now`);

  const row = rows[0];
  const elapsed = Date.now() - started;

  console.log("Database reachable through Drizzle.");
  console.log(`  database  ${row.database}`);
  console.log(`  server    ${row.version.split(",")[0]}`);
  console.log(`  time      ${row.now}`);
  console.log(`  round trip ${elapsed}ms`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Could not reach the database.");
    console.error(error instanceof Error ? error.message : error);
    console.error(
      "\nCheck DATABASE_URL in your .env file. It should be the Supabase\n" +
        "transaction mode pooler on port 6543, and the project must not be paused.",
    );
    process.exit(1);
  });
