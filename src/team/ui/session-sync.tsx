"use client";

/**
 * The client side follow up to a self action (spec 0015, AC-7).
 *
 * After an admin leaves the agency, their session token still names the
 * organization until it refreshes, so the page asks Clerk to set the active
 * organization to none before going to `/onboarding`. After a self demotion
 * it reactivates the same organization, which reissues the token with the
 * new role, then refreshes so the member view renders at once.
 *
 * Provided by the page only when Clerk is live: `useClerk()` throws outside
 * `ClerkProvider`, and the `/design` gallery renders these controls with no
 * provider at all. A control reads the context and simply skips the step
 * when nothing provided it.
 */
import { useClerk } from "@clerk/nextjs";
import { createContext, useContext, type ReactNode } from "react";

export type SessionSync = {
  readonly leftAgency: () => Promise<void>;
  readonly roleChanged: (clerkOrgId: string) => Promise<void>;
};

const SessionSyncContext = createContext<SessionSync | undefined>(undefined);

export function ClerkSessionSync({
  children,
}: {
  readonly children: ReactNode;
}) {
  const clerk = useClerk();

  const value: SessionSync = {
    leftAgency: async () => {
      await clerk.setActive({ organization: null });
    },
    roleChanged: async (clerkOrgId) => {
      await clerk.setActive({ organization: clerkOrgId });
    },
  };

  return (
    <SessionSyncContext.Provider value={value}>
      {children}
    </SessionSyncContext.Provider>
  );
}

export function useSessionSync(): SessionSync | undefined {
  return useContext(SessionSyncContext);
}
