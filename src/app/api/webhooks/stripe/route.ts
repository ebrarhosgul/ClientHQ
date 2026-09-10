/**
 * `POST /api/webhooks/stripe`.
 *
 * One of the three files in the project allowed to import `withSystemAccess`,
 * and it is a short file on purpose: everything worth reading about the
 * ordering, the idempotency ledger and the rollback lives in
 * `src/payments/webhook.ts`, which takes its database handle as an argument so
 * it can be tested without one.
 *
 * A Stripe event arrives with a signature, not a session. There is no tenant to
 * resolve and no accessor to scope, which is the case spec 0003 opened the
 * second door for.
 */
import { withSystemAccess } from "@/db/tenant/system";
import { liveStripeGateway } from "@/payments/gateway";
import { handleStripeWebhook } from "@/payments/webhook";

// Never prerendered, never cached: every delivery is a distinct write.
export const dynamic = "force-dynamic";

// The postgres driver needs a TCP socket, and signature verification needs the
// body byte for byte. Both rule out the edge runtime.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // `request.text()`, never `request.json()`: the signature covers the raw
  // bytes, and re serialising a parsed body would not reproduce them.
  const body = await request.text();
  const signature = request.headers.get("stripe-signature") ?? undefined;

  const result = await withSystemAccess(
    "stripe webhook: a signed provider event, no session to scope to",
    (db) =>
      handleStripeWebhook({
        db,
        gateway: liveStripeGateway(),
        body,
        signature,
      }),
  );

  // The body is for a person reading Stripe's delivery log. Stripe itself only
  // reads the status: 200 handled, 400 unverifiable, 500 try again.
  return Response.json({ outcome: result.outcome }, { status: result.status });
}
