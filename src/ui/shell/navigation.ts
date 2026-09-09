import {
  Building2,
  CreditCard,
  FolderKanban,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Every path this product commits to, fixed here so no later feature has to
 * guess and no two features can pick different ones (AC-23).
 *
 * Items whose feature has not shipped yet are still real links. The agency
 * route group carries a `not-found.tsx`, so clicking one lands on a proper page
 * inside the shell rather than a bare 404.
 */
export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** The feature that builds this section, for anyone reading the sidebar. */
  readonly feature: number;
};

/** The work. This is what an agency opens the product to do. */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, feature: 6 },
  { href: "/clients", label: "Clients", icon: Building2, feature: 7 },
  { href: "/projects", label: "Projects", icon: FolderKanban, feature: 11 },
  { href: "/invoices", label: "Invoices", icon: Receipt, feature: 13 },
];

/** Running the agency itself. Quieter, because it is visited far less often. */
export const SECONDARY_NAV: readonly NavItem[] = [
  { href: "/team", label: "Team", icon: Users, feature: 16 },
  { href: "/billing", label: "Billing", icon: CreditCard, feature: 8 },
  { href: "/settings", label: "Settings", icon: Settings, feature: 16 },
];

export const ALL_NAV: readonly NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/**
 * Is this nav item the section the reader is in?
 *
 * A prefix match, so `/clients/abc123` still highlights Clients, but anchored
 * at a segment boundary so `/clients-archive` would not.
 */
export function isCurrentSection(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
