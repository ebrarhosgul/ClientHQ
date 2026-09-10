import type { Metadata } from "next";

import { ClientForm } from "@/clients/ui/client-form";
import { PageHeader } from "@/ui/patterns/page-header";

export const metadata: Metadata = {
  title: "New client",
};

/** The blank create form (spec 0006, AC-1). */
export default function NewClientPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New client"
        description="Only the name is required. Add the rest now or later."
      />
      <ClientForm />
    </div>
  );
}
