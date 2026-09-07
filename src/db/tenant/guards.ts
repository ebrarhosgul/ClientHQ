/**
 * Role guards.
 *
 * The authoritative role is the Clerk session claim, carried on the context.
 * `memberships.role` is a display mirror that can be stale until a webhook
 * lands, so no decision here reads it (spec 0003, AC-11).
 *
 * These throw rather than return, so a guarded handler reads as a straight line
 * and the wrapper turns the throw into `forbidden` in one place.
 */
import type { StaffContext, TenantContext } from "./context";
import { tenantActionError } from "./errors";
import { logRefusal } from "./log";

function refuse(ctx: TenantContext, operation: string, reason: string): never {
  logRefusal({
    operation,
    reason,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });

  throw tenantActionError({
    code: "forbidden",
    message: "You do not have permission to do that.",
  });
}

/** Narrow to agency staff. A client contact is refused. */
export function requireStaff(ctx: TenantContext): asserts ctx is StaffContext {
  if (ctx.kind !== "staff") {
    refuse(ctx, "requireStaff", "not_staff");
  }
}

/** Narrow to an agency admin. A member is refused before the handler runs. */
export function requireAdmin(
  ctx: TenantContext,
): asserts ctx is StaffContext & { readonly role: "admin" } {
  requireStaff(ctx);

  if (ctx.role !== "admin") {
    refuse(ctx, "requireAdmin", "not_admin");
  }
}
