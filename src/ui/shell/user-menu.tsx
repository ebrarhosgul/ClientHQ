"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut } from "lucide-react";
import Link from "next/link";

import { cn } from "@/ui/lib/cn";
import { Avatar, AvatarFallback, AvatarImage } from "@/ui/primitives/avatar";
import { Button } from "@/ui/primitives/button";
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

/** Two letters from a name, or from an email when there is no name. */
function initials(name: string | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split("@")[0] || "?";

  return source
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Who you are signed in as, and the way out.
 *
 * Signed out this renders a Sign in link rather than nothing, so the top bar
 * keeps its shape and someone who landed here with no session has somewhere to
 * go (AC-22). The route it points at is built by feature 6.
 */
function ClerkUserMenu({ className }: { readonly className?: string }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();

  if (!isLoaded) {
    return <Skeleton className={cn("size-8 rounded-full", className)} />;
  }

  if (!isSignedIn) {
    return <SignInLink className={className} />;
  }

  const name = user.fullName ?? undefined;
  const email = user.primaryEmailAddress?.emailAddress ?? undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full transition-surface hover:bg-accent",
          className,
        )}
      >
        <Avatar className="size-8">
          {user.imageUrl ? (
            <AvatarImage src={user.imageUrl} alt="" />
          ) : undefined}
          <AvatarFallback>{initials(name, email)}</AvatarFallback>
        </Avatar>
        {/* The avatar itself is decorative: the name is what identifies you. */}
        <span className="sr-only">{`Account: ${name ?? email ?? "your account"}`}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{name ?? email}</span>
          {name && email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : undefined}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/" })}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Sign in link, which is the right answer both signed out and unconfigured. */
function SignInLink({ className }: { readonly className?: string }) {
  return (
    <Button asChild size="sm" className={className}>
      <Link href="/sign-in">Sign in</Link>
    </Button>
  );
}

/**
 * Who you are, or the way in.
 *
 * The Clerk backed menu only mounts when Clerk is live, because its hooks need
 * a provider above them. Unconfigured collapses into the signed out state the
 * shell already has to handle (AC-22), so there is no third case to design.
 */
export function UserMenu({ className }: { readonly className?: string }) {
  const clerkLive = useClerkLive();

  if (!clerkLive) {
    return <SignInLink className={className} />;
  }

  return <ClerkUserMenu className={className} />;
}
