import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { agencyContext } from "@/auth/context";
import { getClient, type ClientRow } from "@/clients/queries";
import { ClientForm } from "@/clients/ui/client-form";
import { isClerkConfigured } from "@/lib/env";
import { PageHeader } from "@/ui/patterns/page-header";

/**
 * With no Clerk publishable key there is no session to resolve a tenant from,
 * so no id can ever be this agency's (spec 0004, AC-22): `undefined`, the same
 * as a foreign agency's id or one that never existed.
 */
async function findClient(id: string): Promise<ClientRow | undefined> {
  return isClerkConfigured() ? getClient(await agencyContext(), id) : undefined;
}

export async function generateMetadata({
  params,
}: PageProps<"/clients/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  const client = await findClient(id);

  return { title: client ? `Edit ${client.name}` : "Client" };
}

/** Pre-filled with the client's current values (spec 0006, AC-7). */
export default async function EditClientPage({
  params,
}: PageProps<"/clients/[id]/edit">) {
  const { id } = await params;
  const client = await findClient(id);

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
