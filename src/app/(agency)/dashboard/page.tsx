import type { Metadata } from "next";

import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * The shell, rendering in the real application, over an empty body.
 *
 * Empty on purpose. What goes here (open projects, overdue invoices, recent
 * deliverables) needs features 11, 12 and 13 to exist first, and spec 0004's
 * job is the chrome those features hang off. What this page proves today is
 * that the shell renders on the real system, signed in and signed out
 * (AC-22).
 */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Where your agency's week is summarised, once there is a week to summarise."
      />

      <EmptyState
        heading="Nothing to show yet"
        description="Open projects, overdue invoices and recent deliverables land here as those parts of the product are built. Start by adding a client."
      />
    </>
  );
}
