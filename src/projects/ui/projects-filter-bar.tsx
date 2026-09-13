import Link from "next/link";

import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";

/**
 * The status, client and archived controls, all URL driven (spec 0010,
 * AC-4, AC-5).
 *
 * The status and client pickers are one GET form, so choosing either always
 * lands on page 1 with no page number carried along; the archived toggle is a
 * pair of plain links for the same reason, each carrying the other two
 * filters forward.
 */
export type ProjectsClientOption = {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
};

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All statuses" },
  { value: "planning", label: "Planning" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "delivered", label: "Delivered" },
] as const;

function archivedLinkHref(
  target: boolean,
  status: string | undefined,
  client: string | undefined,
): string {
  const params = new URLSearchParams();

  if (status) {
    params.set("status", status);
  }

  if (client) {
    params.set("client", client);
  }

  if (target) {
    params.set("archived", "true");
  }

  const query = params.toString();

  return query ? `/projects?${query}` : "/projects";
}

export function ProjectsFilterBar({
  status,
  statusParam,
  clientId,
  archived,
  clientOptions,
}: {
  /** The effective status (the implicit default filled in), for the select. */
  readonly status: string;
  /**
   * The raw `status` URL param, undefined when the caller relied on the
   * default. The archived toggle links carry this, not `status`: writing the
   * effective default into the link would flip the other list's own default
   * when it is followed (spec 0010, AC-4).
   */
  readonly statusParam?: string;
  /** The raw `client` URL param; cleared (undefined) when it did not resolve. */
  readonly clientId?: string;
  readonly archived: boolean;
  readonly clientOptions: readonly ProjectsClientOption[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <form
        action="/projects"
        method="get"
        className="flex flex-wrap items-end gap-2"
      >
        {archived ? (
          <input type="hidden" name="archived" value="true" />
        ) : undefined}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="projects-status" className="text-xs">
            Status
          </Label>
          <select
            id="projects-status"
            name="status"
            defaultValue={status}
            className="h-9 w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="projects-client" className="text-xs">
            Client
          </Label>
          <select
            id="projects-client"
            name="client"
            defaultValue={clientId ?? ""}
            className="h-9 w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface"
          >
            <option value="">All clients</option>
            {clientOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </form>

      <div
        role="group"
        aria-label="Filter by archived"
        className="flex items-center gap-2"
      >
        <Button
          asChild
          variant={archived ? "outline" : "default"}
          size="sm"
          aria-current={archived ? undefined : "true"}
        >
          <Link href={archivedLinkHref(false, statusParam, clientId)}>
            Active
          </Link>
        </Button>
        <Button
          asChild
          variant={archived ? "default" : "outline"}
          size="sm"
          aria-current={archived ? "true" : undefined}
        >
          <Link href={archivedLinkHref(true, statusParam, clientId)}>
            Archived
          </Link>
        </Button>
      </div>
    </div>
  );
}
