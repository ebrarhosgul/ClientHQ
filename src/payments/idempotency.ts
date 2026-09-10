/**
 * The idempotency key that stops a double click becoming two Checkout Sessions,
 * and worse, two Stripe customers (spec 0007, AC-18).
 *
 * Its own module because a `"use server"` file may export nothing but async
 * functions, and this is a pure one worth testing directly.
 *
 * Everything that could differ between two attempts has to be in the key:
 * Stripe refuses a reused key whose parameters changed, and attaching an
 * existing customer changes them. So the key carries the agency, which customer
 * (if any) is being attached, and a five minute bucket. The bucket is what lets
 * it expire: a genuine second attempt half an hour later gets a fresh session
 * rather than the old one replayed back.
 */
const BUCKET_MS = 5 * 60 * 1000;

export function checkoutIdempotencyKey(
  orgId: string,
  customerId: string | undefined,
  now: Date,
): string {
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  const attaching = customerId ?? "new";

  return `checkout:${orgId}:${attaching}:${bucket}`;
}
