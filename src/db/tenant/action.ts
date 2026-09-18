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

import { analytics, type EventName, type EventProperties } from "@/analytics";
import type { RateLimitPolicy } from "@/rate-limit/policies";

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
import { consume } from "./rate-limit";
import { requireFullAccess } from "./subscription";

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
   * The access gate (spec 0008, AC-6). Unset means the agency must have full
   * access, so a write is refused with `subscription_inactive` in the grace
   * window, when locked, and before subscribing. `"any"` skips that check and
   * is set by exactly two actions, the ones that let an agency pay:
   * `startCheckout` and `openBillingPortal`. Opting out of this gate does not
   * relax `requireRole`.
   */
  readonly subscription?: "any";
  /**
   * The ceiling this action opts into (spec 0018, AC-1, AC-13). One of the
   * three exported policies; the type forbids an ad hoc one. Checked on the
   * pooled executor, after the input parses and before the handler runs, so
   * a refused call has no side effect at all.
   */
  readonly rateLimit?: RateLimitPolicy;
  /**
   * The product event this action reports (spec 0019, AC-10). Fired only
   * after the handler resolved and, with `transaction: true`, after the
   * commit: never on a parse failure, a role or subscription refusal, a rate
   * limit refusal, or a thrown handler. The person and the agency come from
   * the tenant context, never from the action, so a wrong `org_id` on an
   * event is not something an input can cause. The flush is scheduled with
   * `after()`, so the response never waits on the provider.
   */
  readonly track?: ActionTrack<TSchema["_output"], TData>;
};

/**
 * One event from the catalogue, with an optional function that derives its
 * extra properties from the parsed input and the handler's result.
 *
 * `NoInfer` keeps these callbacks from taking part in inferring the
 * handler's result type, so a `track` written above its `handler` in the
 * config still sees the real result rather than `unknown`.
 */
export type ActionTrack<TInput, TData> = {
  readonly [E in EventName]: {
    readonly event: E;
    readonly properties?: (
      input: NoInfer<TInput>,
      result: NoInfer<TData>,
    ) => EventProperties<E>;
    /** Fire only when this holds; a success it does not describe is silent. */
    readonly when?: (input: NoInfer<TInput>, result: NoInfer<TData>) => boolean;
  };
}[EventName];

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
 * Report the action's event, after success only. The client never throws,
 * so this is the one call in the wrapper with no `try` of its own.
 */
function fireTrack<TInput, TData>(
  track: ActionTrack<TInput, TData> | undefined,
  ctx: StaffContext,
  input: TInput,
  result: TData,
): void {
  if (track === undefined || track.when?.(input, result) === false) {
    return;
  }

  analytics().track(track.event, {
    distinctId: { kind: "user", clerkUserId: ctx.clerkUserId },
    orgId: ctx.orgId,
    // The properties function is typed per event above; the client parses
    // the result against that event's schema before anything is sent.
    properties: track.properties?.(input, result),
  } as Parameters<ReturnType<typeof analytics>["track"]>[1]);
}

/**
 * Wrap a handler into a Server Action.
 *
 * The order of the checks is the contract: resolution, then the role guard,
 * then the subscription gate, then parsing, then the rate limit. An expired
 * session is refused before anything is parsed, so the person who is signed
 * out never learns whether their input was valid; a member with a lapsed
 * subscription gets `forbidden` rather than a hint about billing; a locked
 * admin gets `subscription_inactive` before their input is looked at (spec
 * 0008, AC-6); and a caller stopped by any of those never learns a ceiling
 * exists, because the rate limit check runs last, after parsing (spec 0018,
 * AC-2).
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

      // On the pooled executor, before any transaction opens: the transaction
      // below wraps the handler only.
      if (config.subscription !== "any") {
        await requireFullAccess(ctx, operation);
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

      // On the pooled executor, before any transaction opens and after the
      // role and subscription gates: a signed out or locked caller never
      // learns the ceiling exists (AC-2).
      if (config.rateLimit !== undefined) {
        const verdict = await consume(
          { kind: "org", id: ctx.orgId },
          config.rateLimit,
          new Date(),
        );

        if (!verdict.allowed) {
          return failure({ code: "rate_limited", message: verdict.message });
        }
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
      fireTrack(config.track, ctx, parsed.data, data);

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
