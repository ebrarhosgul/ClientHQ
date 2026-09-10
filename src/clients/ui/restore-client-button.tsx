"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { restoreClient } from "@/clients/archive-client";
import { errorMessage } from "@/ui/patterns/error-messages";
import { SubmitButton } from "@/ui/primitives/submit-button";

/** No confirmation needed to bring a client back (spec 0006, AC-9). */
export function RestoreClientButton({
  clientId,
}: {
  readonly clientId: string;
}) {
  const router = useRouter();

  const [state, submit] = useActionState<{ readonly error?: string }, FormData>(
    async () => {
      const result = await restoreClient({ id: clientId });

      if (!result.ok) {
        return { error: errorMessage(result.error) };
      }

      router.refresh();

      return {};
    },
    {},
  );

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <SubmitButton variant="outline" pendingLabel="Restoring…">
        <RotateCcw />
        Restore
      </SubmitButton>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : undefined}
    </form>
  );
}
