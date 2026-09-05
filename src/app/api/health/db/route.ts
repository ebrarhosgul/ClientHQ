import { NextResponse } from "next/server";

/**
 * Does the running app actually reach the database?
 *
 * This exists so the scaffold can prove its own connection, in the deployed app
 * and not only from a local script. It is deliberately dull: one round trip, no
 * schema, no tenant context, nothing written.
 *
 * It reports whether the connection works, never why it failed. A connection
 * error can carry the host and the user, and this route is unauthenticated. The
 * real reason goes to the server log.
 */

// Never prerendered and never cached: a health check answering from a build time
// snapshot would report the wrong thing.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The postgres driver needs a TCP socket, which the edge runtime cannot open.
export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();

  try {
    // Imported inside the handler so a build never needs real credentials to
    // compile this route.
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");

    await db.execute(sql`select 1`);

    return NextResponse.json(
      {
        status: "ok",
        database: "reachable",
        roundTripMs: Date.now() - started,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[health/db] database unreachable", error);

    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 },
    );
  }
}
