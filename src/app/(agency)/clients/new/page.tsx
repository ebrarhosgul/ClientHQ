import { UserCircle } from "lucide-react";
import type { Metadata } from "next";

import { ClientForm } from "@/clients/ui/client-form";
import { isClerkConfigured } from "@/lib/env";
import { EmptyState } from "@/ui/patterns/empty-state";
import { PageHeader } from "@/ui/patterns/page-header";

export const metadata: Metadata = {
  title: "New client",
};

/**
 * The blank create form (spec 0006, AC-1).
 *
 * With no Clerk publishable key there is no possible session to stamp a new
 * row's `org_id` with, so the form itself would only ever fail on submit
 * (spec 0004, AC-22): showing that outcome up front is more honest than a
 * working looking form that cannot succeed.
 */
export default function NewClientPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New client"
        description="Only the name is required. Add the rest now or later."
      />
      {isClerkConfigured() ? (
        <ClientForm />
      ) : (
        <EmptyState
          icon={<UserCircle />}
          heading="Sign in to create a client"
          description="A client belongs to a specific agency, so creating one needs a signed in session."
        />
      )}
    </div>
  );
}
