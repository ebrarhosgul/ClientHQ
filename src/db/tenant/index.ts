/**
 * The tenant scoping data access layer, as the rest of the product sees it.
 *
 * Four names are the whole boundary:
 *
 *   - `tenantContext()` works out who is asking, once per request.
 *   - `tenantDb(ctx)` is the only way to reach a tenant scoped table.
 *   - `withTenantAction()` is the only shape a Server Action takes.
 *   - `unsafeTenantQuery()` is the conspicuous exit for a query the accessor
 *     cannot express, still scoped, with the predicate written by hand.
 *
 * The fifth, `withSystemAccess`, is deliberately *not* re-exported here. It
 * lives in `./system` and ESLint lets only the webhook and cron routes import
 * it, so it cannot be laundered through this barrel.
 *
 * See spec 0003 for the reasoning, and `src/db/AGENTS.md` for the rules.
 */
export {
  tenantDb,
  type ContactAccessor,
  type FindOptions,
  type InsertValues,
  type OrderBy,
  type StaffAccessor,
  type TenantAccessor,
  type TenantReader,
  type UpdatePatch,
} from "./accessor";

export {
  withTenantAction,
  type ActionConfig,
  type ActionHandlerArgs,
  type RevalidateConfig,
  type RevalidateTarget,
} from "./action";

export {
  contactContext,
  staffContext,
  tenantContext,
  toMembershipRole,
  type ContactContext,
  type StaffContext,
  type TenantContext,
} from "./context";

export {
  ACTION_ERROR_CODES,
  RESOLUTION_ERROR_KINDS,
  failure,
  isTenantActionError,
  isTenantResolutionError,
  ok,
  tenantActionError,
  tenantResolutionError,
  type ActionError,
  type ActionErrorCode,
  type FieldErrors,
  type ResolutionErrorKind,
  type Result,
  type TenantActionError,
  type TenantResolutionError,
} from "./errors";

export { requireAdmin, requireStaff } from "./guards";

/**
 * Feature 6's two named provisioning doors. They write the three identity
 * tables, which are not tenant scoped and so cannot go through `tenantDb()`.
 * Narrower than `withSystemAccess` in both the tables and the columns they
 * touch, which is why they are exported here rather than fenced (spec 0005,
 * AC-17).
 */
export {
  agencyProfile,
  deletedOrganizationClerkIds,
  type AgencyProfile,
} from "./organization";

/**
 * Feature 13's one transaction that has to commit before a network call
 * (spec 0012). The raw transaction stays inside the layer: the callback gets
 * a scoped accessor and the invoice numbering door bound to it.
 */
export { tenantTransaction, type TenantTransactionScope } from "./transaction";

export {
  createAgencyRows,
  ensureMirrorRows,
  ensureUserRow,
  suggestedSlug,
  type MirrorIds,
  type MirrorOrganization,
  type MirrorUser,
} from "./provisioning";

/**
 * Feature 10's acceptance door (spec 0009, AC-13). The one place a
 * `client_contacts` row is read with no tenant context: it takes a token, and
 * the row it fetches by primary key names the organization. Narrower than
 * `withSystemAccess`, so exported here rather than fenced.
 */
export {
  acceptInvitation,
  inspectInvitation,
  type AcceptOutcome,
  type InspectOutcome,
  type InvitationIdentity,
} from "./invitation";

export {
  TENANT_TABLE_KEYS,
  type ContactTable,
  type ContactTableKey,
  type TenantTable,
  type TenantTableKey,
} from "./tables";

/**
 * Feature 15's switcher door (spec 0014, AC-11). The second place, alongside
 * `context.ts`'s own fallback read, that reads `client_contacts` across
 * organizations; narrower than `withSystemAccess`, so exported here.
 */
export {
  listAcceptedContactRows,
  type AcceptedContactRow,
} from "./contact-rows";

export { unsafeTenantQuery } from "./unsafe";

/**
 * The handle's *type*, for the webhook and cron routes and the handlers they
 * call: `withSystemAccess` hands one over, and a handler has to be able to name
 * what it was given. A type is not a capability, so the fence around
 * `src/db/client.ts` is untouched by this.
 */
export type { Database, Executor, TransactionExecutor } from "./executor";
