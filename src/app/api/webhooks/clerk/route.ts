/**
 * `POST /api/webhooks/clerk`.
 *
 * One of the three files in the project allowed to import `withSystemAccess`,
 * and it is a short file on purpose: everything worth reading about the
 * ordering, the idempotency ledger and the rollback lives in
 * `src/auth/webhook.ts`, which takes its database handle as an argument so it
 * can be tested without one.
 *
 * A Clerk event arrives with a signature, not a session. There is no tenant to
 * resolve and no accessor to scope, which is the case spec 0003 opened the
 * second door for.
 */
import type { NextRequest } from "next/server";

import { withSystemAccess } from "@/db/tenant/system";

import { liveClerkGateway } from "@/auth/clerk";
import { handleClerkWebhook } from "@/auth/webhook";

// Never prerendered, never cached: every delivery is a distinct write.
export const dynamic = "force-dynamic";

// The postgres driver needs a TCP socket, and `verifyWebhook` needs the raw
// request. Both rule out the edge runtime.
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  // The request is handed through untouched: `verifyWebhook` reads its raw
  // body itself, and reading it here first would leave nothing for that call.
  const result = await withSystemAccess(
    "clerk webhook: a signed provider event, no session to scope to",
    (db) =>
      handleClerkWebhook({
        db,
        gateway: liveClerkGateway(),
        request,
      }),
  );

  return Response.json({ outcome: result.outcome }, { status: result.status });
}
