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
 * Which agency you are acting as.
 *
 * Reads identity through Clerk's React hooks, never through `auth()`: spec 0003
 * keeps `auth()` in exactly one file and this is not it (invariant 2). The
 * price is that the chrome settles a beat after the page, which the skeleton
 * below covers.
 *
 * Selecting an agency calls Clerk's `setActive`; the server sees the change on
 * the next request through the session, which is what the tenant layer reads.
 */
function ClerkAgencySwitcher({ className }: { readonly className?: string }) {
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { organization } = useOrganization();
  const {
    isLoaded: listLoaded,
    userMemberships,
    setActive,
  } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  if (!userLoaded) {
    return <Skeleton className={cn("h-8 w-40", className)} />;
  }

  if (!isSignedIn) {
    return undefined;
  }

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
 * The switcher, or nothing.
 *
 * With Clerk unconfigured there are no agencies to switch between and no hook
 * to call, so this renders nothing and the top bar keeps its shape around the
 * gap. The inner component is what holds the hooks, and it only mounts when
 * there is a `ClerkProvider` above it to serve them.
 */
export function AgencySwitcher({ className }: { readonly className?: string }) {
  const clerkLive = useClerkLive();

  if (!clerkLive) {
    return undefined;
  }

  return <ClerkAgencySwitcher className={className} />;
}
