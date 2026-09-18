/**
 * One structured JSON line per refusal, and per system access grant.
 *
 * Spec 0003, AC-15: every refusal (missing context, a cross tenant miss on a
 * write, a failed role guard, a system access grant) emits exactly one line
 * carrying the operation and the reason always, plus the acting user and
 * organization whenever they are known, and never any row contents. A
 * `no_session` refusal has neither identifier, which is why both are optional.
 *
 * `console` for every line. Vercel collects stdout. Two of the four events
 * are also promoted to Sentry with the same fields (spec 0019, AC-6):
 * `access.invariant`, because it is a webhook bug, and `tenant.escape_hatch`,
 * because spec 0003 wants those call sites counted. A refusal and a system
 * access grant stay log lines only.
 */
import { reportSignal } from "@/observability";

export type TenantLogLine = {
  readonly event:
    | "tenant.refusal"
    | "tenant.system_access"
    | "tenant.escape_hatch"
    | "access.invariant";
  /** The call site's own name, e.g. `update:clients` or `tenantContext.staff`. */
  readonly operation: string;
  /** Why it was refused, or why unscoped access was granted. */
  readonly reason: string;
  readonly userId?: string;
  readonly orgId?: string;
  readonly at: string;
};

export type RefusalDetails = {
  readonly operation: string;
  readonly reason: string;
  readonly userId?: string;
  readonly orgId?: string;
};

function emit(line: TenantLogLine): void {
  // One call, so one line. JSON.stringify drops the undefined identifiers.
  console.warn(JSON.stringify(line));
}

/** Record a refusal. Never called with row data. */
export function logRefusal(details: RefusalDetails): void {
  emit({ event: "tenant.refusal", ...details, at: new Date().toISOString() });
}

/** Record that unscoped database access was handed out, and why. */
export function logSystemAccess(reason: string): void {
  emit({
    event: "tenant.system_access",
    operation: "withSystemAccess",
    reason,
    at: new Date().toISOString(),
  });
}

/** The one state the gate can see that the webhook should never write. */
export type GateInvariantDetails = {
  readonly orgId: string;
  readonly reason: "past_due_without_since";
};

/**
 * Record a subscription row the access gate had to treat as locked because it
 * broke an invariant (spec 0008, AC-3). One line per request and no dedupe on
 * purpose: the state is a webhook bug, and loud is right.
 */
export function logGateInvariant(details: GateInvariantDetails): void {
  emit({
    event: "access.invariant",
    operation: "accessVerdict",
    ...details,
    at: new Date().toISOString(),
  });
  reportSignal("access.invariant", {
    level: "error",
    tags: { org_id: details.orgId },
    extra: { operation: "accessVerdict", reason: details.reason },
    fingerprint: ["access.invariant", "accessVerdict"],
  });
}

/**
 * Record a hand written tenant query. Not a refusal, but worth counting: spec
 * 0003 asks for a look at how many call sites this has grown by slice 6.
 */
export function logEscapeHatch(details: RefusalDetails): void {
  emit({
    event: "tenant.escape_hatch",
    ...details,
    at: new Date().toISOString(),
  });
  reportSignal("tenant.escape_hatch", {
    level: "error",
    tags: { org_id: details.orgId },
    extra: {
      operation: details.operation,
      reason: details.reason,
      userId: details.userId,
    },
    fingerprint: ["tenant.escape_hatch", details.operation],
  });
}
