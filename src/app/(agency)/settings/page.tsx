import type { Metadata } from "next";

import { agencyContext } from "@/auth/context";
import { agencySettings } from "@/db/tenant";
import { isClerkConfigured } from "@/lib/env";
import { SettingsView } from "@/settings/ui/settings-view";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * `/settings`: the agency's profile, read only. Agency name, default currency,
 * tax ID and address, straight from the agency's own `organizations` row.
 *
 * It sits outside the access gate on purpose, next to `/billing`: a locked
 * agency can still see who it is. Editing any of it is a later feature; the
 * page has no form and no action.
 *
 * With no Clerk publishable key there is no session to read a row for, so this
 * shows the "could not be loaded" state a brand new environment would see
 * rather than resolving a tenant context that cannot exist (spec 0004, AC-22).
 */
export default async function SettingsPage() {
  const ctx = isClerkConfigured() ? await agencyContext() : undefined;
  const settings = ctx === undefined ? undefined : await agencySettings(ctx);

  return <SettingsView settings={settings} />;
}
