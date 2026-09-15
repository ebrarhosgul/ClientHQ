"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { Switch } from "@/ui/primitives/switch";

import { setDeliverableVisibility } from "../set-deliverable-visibility";

/**
 * The per file client visibility switch (spec 0011, AC-11).
 *
 * The visible text just says "Visible to client"; `aria-label` carries the
 * file's name too, so a screen reader can tell one row's switch from another
 * without reading the whole list to find context.
 */
export function DeliverableVisibilitySwitch({
  deliverableId,
  name,
  visibleToClient,
}: {
  readonly deliverableId: string;
  readonly name: string;
  readonly visibleToClient: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(visibleToClient);
  const [error, setError] = useState<ReactNode>();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Visible to client</span>
        <Switch
          size="sm"
          checked={checked}
          disabled={pending}
          aria-label={`Visible to client: ${name}`}
          onCheckedChange={(value: boolean) => {
            setChecked(value);
            setError(undefined);

            startTransition(async () => {
              const result = await setDeliverableVisibility({
                deliverableId,
                visibleToClient: value,
              });

              if (!result.ok) {
                setChecked(!value);
                setError(<ActionErrorMessage error={result.error} />);
                return;
              }

              router.refresh();
            });
          }}
        />
      </label>
      {error !== undefined ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : undefined}
    </div>
  );
}
