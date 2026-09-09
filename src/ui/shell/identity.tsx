"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Whether Clerk is live in this environment.
 *
 * A React hook cannot be called conditionally, so a component that calls
 * `useUser()` must not mount at all when there is no `ClerkProvider` above it.
 * This context carries the answer down from the root layout, and the shell's
 * identity components use it to choose between a Clerk backed subcomponent and
 * the signed out one, rather than trying to branch inside a hook.
 *
 * Default `false`, so anything rendered outside the provider (a test, a
 * standalone story) gets the safe branch rather than a crash.
 */
const ClerkLiveContext = createContext(false);

export function IdentityProvider({
  clerkLive,
  children,
}: {
  readonly clerkLive: boolean;
  readonly children: ReactNode;
}) {
  return (
    <ClerkLiveContext.Provider value={clerkLive}>
      {children}
    </ClerkLiveContext.Provider>
  );
}

export function useClerkLive(): boolean {
  return useContext(ClerkLiveContext);
}
