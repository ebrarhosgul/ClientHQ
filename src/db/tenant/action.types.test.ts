/**
 * @vitest-environment node
 *
 * covers: spec 0018 AC-13
 *
 * The wrapper's `rateLimit` slot is typed as the union of the three exported
 * policies, not a general `{ action, limit, windowSeconds }` shape. Checked
 * by `pnpm typecheck`, not at runtime, in the style of
 * `accessor.types.test.ts`: every `@ts-expect-error` below fails the build
 * if the error it expects stops happening.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { CREATE_AGENCY, INVOICE_EMAIL, UPLOAD } from "@/rate-limit/policies";
import type { RateLimitPolicy } from "@/rate-limit/policies";

import { withTenantAction } from "./action";

const input = z.object({ name: z.string() });

/** The same type the wrapper's `rateLimit` slot accepts, isolated so a type
 * error lands on one short line regardless of how Prettier wraps a call. */
function acceptPolicy(policy: RateLimitPolicy): RateLimitPolicy {
  return policy;
}

/** Nothing below is executed; it exists to be typechecked. */
function policySurface(): void {
  // Each of the three exported policies compiles.
  withTenantAction({ input, rateLimit: UPLOAD, handler: async () => "ok" });
  withTenantAction({
    input,
    rateLimit: INVOICE_EMAIL,
    handler: async () => "ok",
  });
  withTenantAction({
    input,
    rateLimit: CREATE_AGENCY,
    handler: async () => "ok",
  });

  // No policy at all still compiles; the slot is optional.
  withTenantAction({ input, handler: async () => "ok" });

  // @ts-expect-error an ad hoc object with an action outside the closed set
  acceptPolicy({ action: "x", limit: 1, windowSeconds: 1 });

  // @ts-expect-error a real action, but a limit that does not match the policy
  acceptPolicy({ action: "upload", limit: 999, windowSeconds: 3600 });
}

describe("the rate limit slot's compile time surface", () => {
  it("is proven by typecheck, not by running", () => {
    expect(typeof policySurface).toBe("function");
  });
});
