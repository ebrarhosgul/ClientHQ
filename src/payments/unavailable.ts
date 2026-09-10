/**
 * Turning a Stripe failure into the project's own refusal.
 *
 * Both billing actions talk to Stripe, and `withTenantAction` deliberately
 * rethrows anything it does not recognise, because an unexpected exception is a
 * bug rather than a business outcome. A Stripe outage is neither: it is a
 * perfectly ordinary thing to tell someone about, so it is caught here and
 * returned as `unavailable`, which is what spec 0007's API surface says both
 * actions answer.
 *
 * The message the agency sees never carries Stripe's own. A provider error can
 * name a key, a price or an account, and none of that belongs on a page. The
 * detail goes to the log, where the tenant layer already puts its refusals.
 */
import { tenantActionError } from "@/db/tenant";

/**
 * Run a Stripe call, or refuse.
 *
 * @param operation the call site, for the log line
 * @param call the Stripe request
 */
export async function throughStripe<T>(
  operation: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (thrown) {
    console.warn(
      JSON.stringify({
        event: "stripe.request_failed",
        operation,
        reason: thrown instanceof Error ? thrown.message : "unknown_error",
        at: new Date().toISOString(),
      }),
    );

    throw tenantActionError({
      code: "unavailable",
      message:
        "Billing is not responding right now. Nothing was charged. Try again in a moment.",
    });
  }
}
