"use client";

import { ChevronRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { ActivationFailed } from "./activation-failed";
import { useActivateAgency } from "./use-activate-agency";

export type AgencyOption = {
  readonly clerkOrgId: string;
  readonly name: string;
  readonly isAdmin: boolean;
};

export type AgencyPickerProps = {
  readonly agencies: readonly AgencyOption[];
};

/**
 * Which agency am I acting as?
 *
 * Only shown to someone who genuinely serves more than one, and shown before
 * they can write anything, because writing into the wrong agency is the mistake
 * this screen exists to prevent (AC-6).
 *
 * A real `<ul>` of real `<button>`s: each one acts rather than navigates, so a
 * button is the honest element, and a screen reader hears how many agencies
 * there are before reading the first.
 */
export function AgencyPicker({ agencies }: AgencyPickerProps) {
  const { ready, state, activate } = useActivateAgency();
  const [chosen, setChosen] = useState<AgencyOption>();

  const choose = (agency: AgencyOption) => {
    setChosen(agency);
    void activate(agency.clerkOrgId);
  };

  if (state === "failed") {
    return (
      <ActivationFailed
        name={chosen?.name}
        onRetry={() => {
          if (chosen !== undefined) {
            choose(chosen);
          }
        }}
      />
    );
  }

  const working = state === "working";

  return (
    <ul className="flex flex-col gap-2">
      {agencies.map((agency) => {
        const isChosen = chosen?.clerkOrgId === agency.clerkOrgId;

        return (
          <li key={agency.clerkOrgId}>
            <button
              type="button"
              disabled={!ready || working}
              aria-busy={(working && isChosen) || undefined}
              onClick={() => {
                choose(agency);
              }}
              className="transition-surface flex w-full items-center justify-between gap-3 rounded-md border border-input bg-background px-4 py-3 text-left hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {agency.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {agency.isAdmin ? "Admin" : "Member"}
                </span>
              </span>

              {working && isChosen ? (
                <LoaderCircle
                  aria-hidden
                  className="size-4 shrink-0 animate-spin"
                />
              ) : (
                <ChevronRight aria-hidden className="size-4 shrink-0" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
