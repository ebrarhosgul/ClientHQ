"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";

import type { AcceptedContactRow } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { cn } from "@/ui/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/primitives/dropdown-menu";

import { switchContact } from "../switch-contact";

/**
 * The `Switch client` menu (spec 0014, AC-11), shown only when a person holds
 * more than one accepted row; the caller decides that, this component always
 * renders the menu it is given.
 *
 * On success `switchContact` redirects, so the menu closing on select is
 * never seen. On refusal the error renders outside `DropdownMenuContent`, as
 * a sibling, so it survives Radix closing the menu on select rather than
 * disappearing with it.
 */
export function ClientSwitcher({
  rows,
  currentContactId,
  clientName,
  className,
}: {
  readonly rows: readonly AcceptedContactRow[];
  readonly currentContactId: string;
  readonly clientName: string;
  readonly className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ReactNode>();

  function choose(contactId: string) {
    if (contactId === currentContactId) {
      return;
    }

    setError(undefined);

    startTransition(async () => {
      const result = await switchContact({ contactId });

      if (!result.ok) {
        setError(<ActionErrorMessage error={result.error} />);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className={cn(
            "inline-flex h-8 max-w-56 items-center gap-2 truncate rounded-md px-2 text-sm font-semibold transition-surface hover:bg-accent hover:text-accent-foreground",
            className,
          )}
        >
          <span className="truncate">{clientName}</span>
          <ChevronsUpDown
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">Switch client</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch client</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {rows.map((row) => {
            const current = row.contactId === currentContactId;

            return (
              <DropdownMenuItem
                key={row.contactId}
                disabled={pending}
                onSelect={() => choose(row.contactId)}
              >
                <span className="truncate">
                  {row.clientName} · {row.agencyName}
                </span>
                {current ? (
                  <>
                    <Check aria-hidden className="ml-auto size-4 shrink-0" />
                    <span className="sr-only">(current)</span>
                  </>
                ) : undefined}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {error !== undefined ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : undefined}
    </div>
  );
}
