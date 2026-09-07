import { createGuardedImportRule } from "./guarded-import-rule.mjs";

/**
 * `clienthq/no-system-access-import`
 *
 * The second door, kept shut.
 *
 * `withSystemAccess` hands out unscoped database access. Exactly two kinds of
 * caller legitimately have no tenant: a provider webhook, which arrives with a
 * signed event rather than a session, and the daily cron, which sweeps every
 * organization on purpose. Spec 0003 lets those route files import it and
 * nothing else, so the door stays a door rather than becoming a shortcut.
 *
 * The exemption list lives in `eslint.config.mjs`.
 */
const rule = createGuardedImportRule({
  guarded: ["db", "tenant", "system"],
  description:
    "Disallow importing withSystemAccess outside the webhook and cron routes",
  messageId: "systemAccessImport",
  message:
    "`withSystemAccess` grants unscoped database access and belongs to the " +
    "webhook and cron routes only. Use `tenantDb(ctx)` for tenant work, or " +
    "`unsafeTenantQuery(ctx, reason, fn)` for a query the accessor cannot " +
    "express.",
});

export default rule;
