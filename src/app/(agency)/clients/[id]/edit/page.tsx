import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { agencyContext } from "@/auth/context";
import { getClient } from "@/clients/queries";
import { ClientForm } from "@/clients/ui/client-form";
import { PageHeader } from "@/ui/patterns/page-header";

export async function generateMetadata({
  params,
}: PageProps<"/clients/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  const ctx = await agencyContext();
  const client = await getClient(ctx, id);

  return { title: client ? `Edit ${client.name}` : "Client" };
}

/** Pre-filled with the client's current values (spec 0006, AC-7). */
export default async function EditClientPage({
  params,
}: PageProps<"/clients/[id]/edit">) {
  const { id } = await params;
  const ctx = await agencyContext();
  const client = await getClient(ctx, id);

  if (client === undefined) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Edit ${client.name}`} />
      <ClientForm client={client} />
    </div>
  );
}
