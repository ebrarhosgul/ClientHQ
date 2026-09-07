/**
 * One structured JSON line per refusal, and per system access grant.
 *
 * Spec 0003, AC-15: every refusal (missing context, a cross tenant miss on a
 * write, a failed role guard, a system access grant) emits exactly one line
 * carrying the operation and the reason always, plus the acting user and
 * organization whenever they are known, and never any row contents. A
 * `no_session` refusal has neither identifier, which is why both are optional.
 *
 * Deliberately `console` and nothing else. Vercel collects stdout, and error
 * tracking is feature 20's decision, not this layer's.
 */

export type TenantLogLine = {
  readonly event:
    "tenant.refusal" | "tenant.system_access" | "tenant.escape_hatch";
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
}
