import Link from "next/link";

import { INVOICE_STATUS_PRESENTATION } from "@/ui/patterns/status-chip";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";

import { INVOICE_STATUSES } from "../status";

/**
 * The status, client and void controls, all URL driven (spec 0012, AC-10).
 *
 * The status and client pickers are one GET form, so choosing either always
 * lands on page 1 with no page number carried along; the void toggle is a
 * pair of plain links for the same reason, each carrying the other two
 * filters forward. The same shape as the projects filter bar.
 */
export type InvoicesClientOption = {
  readonly id: string;
  readonly name: string;
  readonly archived?: boolean;
};

function voidLinkHref(
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
    params.set("void", "true");
  }

  const query = params.toString();

  return query ? `/invoices?${query}` : "/invoices";
}

export function InvoicesFilterBar({
  status,
  clientId,
  includeVoid,
  clientOptions,
}: {
  /** The raw `status` URL param, undefined for the default (every status but void). */
  readonly status?: string;
  /** The raw `client` URL param; cleared (undefined) when it did not resolve. */
  readonly clientId?: string;
  readonly includeVoid: boolean;
  readonly clientOptions: readonly InvoicesClientOption[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <form
        action="/invoices"
        method="get"
        className="flex flex-wrap items-end gap-2"
      >
        {includeVoid ? (
          <input type="hidden" name="void" value="true" />
        ) : undefined}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoices-status" className="text-xs">
            Status
          </Label>
          <select
            id="invoices-status"
            name="status"
            defaultValue={status ?? ""}
            className="h-9 w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-surface"
          >
            <option value="">All open</option>
            {INVOICE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {INVOICE_STATUS_PRESENTATION[value].label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoices-client" className="text-xs">
            Client
          </Label>
          <select
            id="invoices-client"
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
        aria-label="Show voided invoices"
        className="flex items-center gap-2"
      >
        <Button
          asChild
          variant={includeVoid ? "outline" : "default"}
          size="sm"
          aria-current={includeVoid ? undefined : "true"}
        >
          <Link href={voidLinkHref(false, status, clientId)}>Hide void</Link>
        </Button>
        <Button
          asChild
          variant={includeVoid ? "default" : "outline"}
          size="sm"
          aria-current={includeVoid ? "true" : undefined}
        >
          <Link href={voidLinkHref(true, status, clientId)}>Show void</Link>
        </Button>
      </div>
    </div>
  );
}
