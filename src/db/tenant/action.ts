/**
 * The write path: one shape every Server Action in the product shares.
 *
 * A wrapped action declares its input schema, is parsed once before its handler
 * runs, gets a scoped accessor it cannot widen, and returns a `Result` whose
 * error codes are a closed union the UI can switch on exhaustively (spec 0003,
 * AC-8 through AC-11, AC-14).
 *
 * The wrapper is where thrown things become returned things, and it is
 * deliberately narrow about which: a resolution failure, a deliberate refusal,
 * and the two PostgreSQL constraint violations. Everything else propagates,
 * because an unexpected exception is a bug, not a business outcome.
 */
import { revalidatePath, updateTag } from "next/cache";
import { flattenError, type ZodType } from "zod";

import { tenantDb, type StaffAccessor } from "./accessor";
import { tenantContext, type StaffContext } from "./context";
import {
  failure,
  isTenantActionError,
  isTenantResolutionError,
  ok,
  type ActionError,
  type FieldErrors,
  type Result,
} from "./errors";
import { pooledDb } from "./executor";
import { requireAdmin, requireStaff } from "./guards";
import { logRefusal } from "./log";

/** A path to revalidate. The `type` form is required for a dynamic segment. */
export type RevalidateTarget =
  string | { readonly path: string; readonly type: "page" | "layout" };

export type RevalidateConfig = {
  readonly paths?: readonly RevalidateTarget[];
  readonly tags?: readonly string[];
};

export type ActionHandlerArgs<TInput> = {
  readonly input: TInput;
  readonly ctx: StaffContext;
  /** Scoped to `ctx`, and to the open transaction when one was declared. */
  readonly db: StaffAccessor;
};

export type ActionConfig<TSchema extends ZodType, TData> = {
  /** Used in the refusal log. Defaults to the handler's own name. */
  readonly name?: string;
  /** Parsed before the handler runs. The only parse at this boundary. */
  readonly input: TSchema;
  /** `staff` by default; `admin` refuses a member before the handler runs. */
  readonly requireRole?: "admin" | "staff";
  /** Invoked exactly once, after a successful handler only. */
  readonly revalidate?: RevalidateConfig;
  /** Run the handler inside one transaction, so a throw rolls back every write. */
  readonly transaction?: boolean;
  readonly handler: (
    args: ActionHandlerArgs<TSchema["_output"]>,
  ) => Promise<TData>;

  /**
   * Reserved for feature 9, the subscription access gate. Typed `never` on
   * purpose: the slot is named so the shape does not change when it lands, and
   * setting it today is a compile error rather than a silent no-op.
   */
  readonly subscription?: never;
  /** Reserved for feature 19, the rate limiter. Same reasoning as above. */
  readonly rateLimit?: never;
};

/** A PostgreSQL error, as the postgres-js driver surfaces it. */
type DriverError = { readonly code: string; readonly constraint_name?: string };

function driverError(value: unknown): DriverError | undefined {
  return value instanceof Error &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
    ? (value as unknown as DriverError)
    : undefined;
}

function fieldErrorsOf(error: Parameters<typeof flattenError>[0]): FieldErrors {
  const flattened = flattenError(error);

  return flattened.fieldErrors as FieldErrors;
}

function revalidate(config: RevalidateConfig | undefined): void {
  config?.paths?.forEach((target) => {
    if (typeof target === "string") {
      revalidatePath(target);
    } else {
      revalidatePath(target.path, target.type);
    }
  });

  // `updateTag` rather than `revalidateTag`: this runs after a write inside a
  // Server Action, where the person who just made the change has to see it, not
  // a stale copy while a revalidation catches up.
  config?.tags?.forEach((tag) => {
    updateTag(tag);
  });
}

/**
 * Turn a thrown value into the Result it belongs to, or hand it back to be
 * rethrown.
 */
function toActionError(
  thrown: unknown,
  operation: string,
): ActionError | undefined {
  if (isTenantResolutionError(thrown)) {
    if (thrown.kind === "no_mirror_row") {
      logRefusal({ operation, reason: "no_mirror_row" });

      return {
        code: "unavailable",
        message: "Your account is still being set up. Try again in a moment.",
      };
    }

    return {
      code: "unauthenticated",
      message: "Sign in again to continue.",
    };
  }

  if (isTenantActionError(thrown)) {
    return thrown.error;
  }

  const driver = driverError(thrown);

  if (driver?.code === "23505" || driver?.code === "23514") {
    // The constraint name goes to the log and never to the person, because it
    // names columns and tables they have no business seeing.
    logRefusal({
      operation,
      reason: `constraint:${driver.code}:${driver.constraint_name ?? "unknown"}`,
    });

    return {
      code: "conflict",
      message: "That change conflicts with something already saved.",
    };
  }

  return undefined;
}

/**
 * Wrap a handler into a Server Action.
 *
 * Resolution comes first, so an expired session is refused before anything is
 * parsed, and the person who is signed out never learns whether their input was
 * valid.
 */
export function withTenantAction<TSchema extends ZodType, TData>(
  config: ActionConfig<TSchema, TData>,
): (input: unknown) => Promise<Result<TData>> {
  const operation = config.name ?? config.handler.name ?? "action";

  return async function tenantAction(input: unknown): Promise<Result<TData>> {
    try {
      const ctx = await tenantContext();

      if (config.requireRole === "admin") {
        requireAdmin(ctx);
      } else {
        requireStaff(ctx);
      }

      const parsed = config.input.safeParse(input);

      if (!parsed.success) {
        logRefusal({
          operation,
          reason: "validation",
          userId: ctx.userId,
          orgId: ctx.orgId,
        });

        return failure({
          code: "validation",
          message: "Some of that is not right yet.",
          fieldErrors: fieldErrorsOf(parsed.error),
        });
      }

      const data = config.transaction
        ? await (
            await pooledDb()
          ).transaction(async (tx) =>
            config.handler({
              input: parsed.data,
              ctx,
              db: tenantDb(ctx, tx),
            }),
          )
        : await config.handler({
            input: parsed.data,
            ctx,
            db: tenantDb(ctx),
          });

      // After a successful handler, and only then.
      revalidate(config.revalidate);

      return ok(data);
    } catch (thrown) {
      const error = toActionError(thrown, operation);

      if (error === undefined) {
        throw thrown;
      }

      return failure(error);
    }
  };
}
