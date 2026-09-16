import type { Metadata } from "next";
import Link from "next/link";

import { formatBytes } from "@/deliverables/format";
import { formatInvoiceNumber } from "@/invoices/status";
import { formatMoney } from "@/lib/money";
import { OverdueBadge } from "@/projects/ui/overdue-badge";
import {
  OVERVIEW_FILES_EMPTY,
  OVERVIEW_INVOICES_EMPTY,
  OVERVIEW_PROJECTS_EMPTY,
} from "@/portal/copy";
import { portalContext } from "@/portal/context";
import { overviewData } from "@/portal/queries";
import { OverviewSection } from "@/portal/ui/overview-section";
import { PortalEmptyState } from "@/portal/ui/portal-empty-state";
import {
  InvoiceStatusChip,
  ProjectStatusChip,
} from "@/ui/patterns/status-chip";

export async function generateMetadata(): Promise<Metadata> {
  const { clientName } = await portalContext();

  return { title: `Overview · ${clientName} · ClientHQ` };
}

/** The overview (spec 0014, AC-5): three capped blocks, one per section. */
export default async function PortalOverviewPage() {
  const { ctx } = await portalContext();
  const { projects, files, invoices } = await overviewData(ctx);

  return (
    <div className="flex flex-col gap-8">
      <OverviewSection id="projects" title="Projects">
        {projects.length === 0 ? (
          <PortalEmptyState
            heading={OVERVIEW_PROJECTS_EMPTY.heading}
            description={OVERVIEW_PROJECTS_EMPTY.description}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link
                  href={`/portal/projects/${project.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {project.name}
                </Link>
                <span className="inline-flex items-center gap-2">
                  <ProjectStatusChip status={project.status} />
                  {project.overdue ? <OverdueBadge /> : undefined}
                </span>
                <span className="text-sm text-muted-foreground">
                  Due {project.dueDate ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </OverviewSection>

      <OverviewSection id="files" title="Files">
        {files.length === 0 ? (
          <PortalEmptyState
            heading={OVERVIEW_FILES_EMPTY.heading}
            description={OVERVIEW_FILES_EMPTY.description}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link
                  href={`/deliverables/${file.id}/download`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {file.name}
                </Link>
                <Link
                  href={`/portal/projects/${file.projectId}`}
                  className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                >
                  {file.projectName}
                </Link>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatBytes(file.sizeBytes)}
                </span>
                <time
                  dateTime={file.createdAt.toISOString()}
                  className="text-sm text-muted-foreground"
                >
                  Added {file.createdAt.toISOString().slice(0, 10)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </OverviewSection>

      <OverviewSection id="invoices" title="Invoices">
        {invoices.length === 0 ? (
          <PortalEmptyState
            heading={OVERVIEW_INVOICES_EMPTY.heading}
            description={OVERVIEW_INVOICES_EMPTY.description}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <Link
                  href={`/portal/invoices/${invoice.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {formatInvoiceNumber(invoice.number)}
                </Link>
                <span className="text-sm text-muted-foreground">
                  Due {invoice.dueDate ?? "—"}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {formatMoney(invoice.totalCents, invoice.currency)}
                </span>
                <InvoiceStatusChip status={invoice.status} />
              </li>
            ))}
          </ul>
        )}
      </OverviewSection>
    </div>
  );
}
