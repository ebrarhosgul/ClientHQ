import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { agencyContext } from "@/auth/context";
import { getClient, type ClientRow } from "@/clients/queries";
import { ArchiveClientButton } from "@/clients/ui/archive-client-button";
import { RestoreClientButton } from "@/clients/ui/restore-client-button";
import { ContactsSection } from "@/contacts/ui/contacts-section";
import { isClerkConfigured } from "@/lib/env";
import { countActiveProjects } from "@/projects/queries";
import { ProjectsSection } from "@/projects/ui/projects-section";
import { Badge } from "@/ui/primitives/badge";
import { PageHeader } from "@/ui/patterns/page-header";
import { Button } from "@/ui/primitives/button";

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
}: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const client = await findClient(id);

  return { title: client?.name ?? "Client" };
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

/**
 * Every field on file for one client, and whether it is archived (spec 0006,
 * AC-6).
 *
 * A foreign agency's id resolves exactly like a missing one: `getClient` scopes
 * through `tenantDb`, so there is no row to tell the two apart (AC-11).
 */
export default async function ClientDetailPage({
  params,
}: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const client = await findClient(id);

  if (client === undefined) {
    notFound();
  }

  const archived = client.archivedAt !== null;
  const activeProjectCount = isClerkConfigured()
    ? await countActiveProjects(await agencyContext(), client.id)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={client.name}
        description={archived ? "Archived" : undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/clients/${client.id}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            {archived ? (
              <RestoreClientButton clientId={client.id} />
            ) : (
              <ArchiveClientButton
                clientId={client.id}
                clientName={client.name}
                activeProjectCount={activeProjectCount}
              />
            )}
          </>
        }
      />

      {archived ? <Badge variant="secondary">Archived</Badge> : undefined}

      <div className="grid gap-6 rounded-lg border border-border bg-card p-4 text-card-foreground sm:grid-cols-2">
        <Detail label="Company email" value={client.companyEmail} />
        <Detail label="Phone" value={client.phone} />
        <Detail label="Industry" value={client.industry} />
        <Detail label="Notes" value={client.notes} />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground">
        <h2 className="text-base font-semibold tracking-tight">
          Billing address
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <Detail label="Address line 1" value={client.billingAddressLine1} />
          <Detail label="Address line 2" value={client.billingAddressLine2} />
          <Detail label="City" value={client.billingCity} />
          <Detail label="State or province" value={client.billingRegion} />
          <Detail label="Postal code" value={client.billingPostalCode} />
          <Detail label="Country" value={client.billingCountry} />
        </div>
      </div>

      <ContactsSection client={client} />

      <ProjectsSection client={client} />
    </div>
  );
}
