"use client";

import { useOrganization, useOrganizationList, useUser } from "@clerk/nextjs";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/ui/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";
import { Skeleton } from "@/ui/primitives/skeleton";

import { useClerkLive } from "./identity";

/**
 * The picker itself, which is the only part that asks Clerk about organizations.
 *
 * Split out deliberately. A hook cannot be called conditionally, so if
 * `useOrganizationList` lived in the component above it would run for a signed
 * out visitor too, asking for a list of agencies that by definition does not
 * exist. Clerk answers that with a blocking development modal when the
 * Organizations feature is off, over a page that never wanted an agency list.
 *
 * Reads identity through Clerk's React hooks, never through `auth()`: spec 0003
 * keeps `auth()` in exactly one file and this is not it (invariant 2). The
 * price is that the chrome settles a beat after the page, which the skeleton
 * covers.
 *
 * Selecting an agency calls Clerk's `setActive`; the server sees the change on
 * the next request through the session, which is what the tenant layer reads.
 */
function OrganizationPicker({ className }: { readonly className?: string }) {
  const { organization } = useOrganization();
  const {
    isLoaded: listLoaded,
    userMemberships,
    setActive,
  } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const memberships = userMemberships?.data ?? [];
  const name = organization?.name ?? "No agency selected";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-8 max-w-56 items-center gap-2 rounded-md px-2 text-sm font-medium transition-surface hover:bg-accent hover:text-accent-foreground",
          className,
        )}
      >
        <span className="truncate">{name}</span>
        <ChevronsUpDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">Switch agency</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your agencies</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {!listLoaded ? (
          <div className="p-2">
            <Skeleton className="h-8 w-full" />
          </div>
        ) : memberships.length === 0 ? (
          <DropdownMenuItem disabled>
            You belong to no agency yet
          </DropdownMenuItem>
        ) : (
          memberships.map((membership) => {
            const current = membership.organization.id === organization?.id;

            return (
              <DropdownMenuItem
                key={membership.organization.id}
                onSelect={() =>
                  setActive?.({ organization: membership.organization.id })
                }
              >
                <span className="truncate">{membership.organization.name}</span>
                {current ? (
                  <>
                    <Check aria-hidden className="ml-auto size-4" />
                    <span className="sr-only">(current)</span>
                  </>
                ) : undefined}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Is anybody signed in? Only then is there an agency list worth asking for.
 *
 * This layer holds `useUser` and nothing else, so the organization hooks below
 * it never run for a visitor who has no organizations to list.
 */
function SignedInAgencySwitcher({
  className,
}: {
  readonly className?: string;
}) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return <Skeleton className={cn("h-8 w-40", className)} />;
  }

  if (!isSignedIn) {
    return undefined;
  }

  return <OrganizationPicker className={className} />;
}

/**
 * The switcher, or nothing.
 *
 * Three layers, each guarding the hooks in the one below it: Clerk configured
 * at all, then somebody signed in, then the organization calls. With Clerk
 * unconfigured this renders nothing and the top bar keeps its shape around the
 * gap.
 */
export function AgencySwitcher({ className }: { readonly className?: string }) {
  const clerkLive = useClerkLive();

  if (!clerkLive) {
    return undefined;
  }

  return <SignedInAgencySwitcher className={className} />;
}
