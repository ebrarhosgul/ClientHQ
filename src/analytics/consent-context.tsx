"use client";

/**
 * The consent choice, carried down from the root layout's cookie read and
 * changed in place by the banner (spec 0019, AC-18), so the banner can go
 * and the analytics provider can switch persistence with no reload.
 *
 * Default `undecided` outside the provider, the safe reading: no cookie.
 */
import { createContext, useContext, useState, type ReactNode } from "react";

import type { ConsentState } from "./consent-state";

type ConsentContextValue = {
  readonly consent: ConsentState;
  readonly setConsent: (next: ConsentState) => void;
};

const ConsentContext = createContext<ConsentContextValue>({
  consent: "undecided",
  setConsent: () => undefined,
});

export function ConsentProvider({
  initial,
  children,
}: {
  readonly initial: ConsentState;
  readonly children: ReactNode;
}) {
  const [consent, setConsent] = useState<ConsentState>(initial);

  return (
    <ConsentContext.Provider value={{ consent, setConsent }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  return useContext(ConsentContext);
}
