import { unstable_rethrow } from "next/navigation";

/**
 * A promise's outcome as a value, never a throw (spec 0020 addendum, Feature
 * design). Lets `OverviewSection` and `InvoicedTrendSection` await several
 * reads in parallel and decide, with no mutable `let`, whether to render
 * their cards or their shared `ErrorState`.
 *
 * `unstable_rethrow(error)` runs first, so a Next.js control flow signal
 * (a redirect or a not found) still passes straight through, exactly as the
 * three original sections' own `try`/`catch` already does.
 */
export type Settled<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: unknown };

export async function settle<TValue>(
  promise: Promise<TValue>,
): Promise<Settled<TValue>> {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error };
  }
}
