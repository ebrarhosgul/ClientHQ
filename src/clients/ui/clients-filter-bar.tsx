import { Search } from "lucide-react";
import Link from "next/link";

import { Button } from "@/ui/primitives/button";
import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

/**
 * The name search and the active/archived toggle, both URL driven (spec 0006,
 * AC-4, AC-5).
 *
 * A plain GET form and two links: no client state, and no page number in
 * either, so submitting a search or switching the toggle always lands on
 * page 1 (spec 0006, Value sourcing).
 */
function filterHref(archived: boolean, search: string | undefined): string {
  const params = new URLSearchParams();

  if (search) {
    params.set("q", search);
  }

  if (archived) {
    params.set("archived", "true");
  }

  const query = params.toString();

  return query ? `/clients?${query}` : "/clients";
}

export function ClientsFilterBar({
  archived,
  search,
}: {
  readonly archived: boolean;
  readonly search?: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <form
        action="/clients"
        method="get"
        role="search"
        className="flex items-center gap-2"
      >
        {archived ? (
          <input type="hidden" name="archived" value="true" />
        ) : undefined}
        <Label htmlFor="clients-search" className="sr-only">
          Search clients by name
        </Label>
        <Input
          id="clients-search"
          type="search"
          name="q"
          defaultValue={search ?? ""}
          placeholder="Search by name"
          className="w-full sm:w-64"
        />
        <Button type="submit" variant="outline" size="icon" aria-label="Search">
          <Search />
        </Button>
      </form>

      <div
        role="group"
        aria-label="Filter by status"
        className="flex items-center gap-2"
      >
        <Button
          asChild
          variant={archived ? "outline" : "default"}
          size="sm"
          aria-current={archived ? undefined : "true"}
        >
          <Link href={filterHref(false, search)}>Active</Link>
        </Button>
        <Button
          asChild
          variant={archived ? "default" : "outline"}
          size="sm"
          aria-current={archived ? "true" : undefined}
        >
          <Link href={filterHref(true, search)}>Archived</Link>
        </Button>
      </div>
    </div>
  );
}
