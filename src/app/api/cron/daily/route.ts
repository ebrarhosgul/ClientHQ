/**
 * `GET /api/cron/daily`.
 *
 * One of the three files in the project allowed to import `withSystemAccess`:
 * the sweep crosses every agency by design, so there is no tenant to resolve.
 * Vercel Cron sends the bearer token on its own once `vercel.json`'s `crons`
 * entry exists; a manual `curl -H "Authorization: Bearer $CRON_SECRET" …`
 * works the same way.
 *
 * The secret check runs before anything else and reads or writes nothing on a
 * miss (spec 0017, AC-1). Everything else, the run record, the sweep order,
 * the per sweep isolation, lives in `src/cron/runner.ts`, which takes its
 * database handle as an argument so it can be tested without one.
 */
import type { NextRequest } from "next/server";

import { withSystemAccess } from "@/db/tenant/system";
import { env } from "@/lib/env";

import { DAILY_SWEEPS } from "@/cron/daily";
import { logCronUnauthorized } from "@/cron/log";
import { runDailySweeps } from "@/cron/runner";
import { isAuthorized } from "@/cron/secret";

// Never prerendered, never cached: every call is a distinct run.
export const dynamic = "force-dynamic";

// The postgres driver needs a TCP socket, which rules out the edge runtime.
export const runtime = "nodejs";

// Two provider reconciles walk every object in two accounts; give the run the
// most Vercel allows rather than the framework default (spec 0017, AC-11).
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request.headers.get("authorization"), env().CRON_SECRET)) {
    logCronUnauthorized();

    return Response.json({}, { status: 401 });
  }

  const result = await withSystemAccess(
    "daily cron: scheduled sweep across every agency, no session to scope to",
    (db) => runDailySweeps({ db, sweeps: DAILY_SWEEPS, now: new Date() }),
  );

  return Response.json(result, {
    status: result.outcome === "ok" ? 200 : 500,
  });
}
