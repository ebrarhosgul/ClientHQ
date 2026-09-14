"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { SubmitButton } from "@/ui/primitives/submit-button";

import { restoreProject } from "../archive-project";

/** No confirmation needed to bring a project back (spec 0010, AC-11). */
export function RestoreProjectButton({
  projectId,
}: {
  readonly projectId: string;
}) {
  const router = useRouter();

  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async () => {
    const result = await restoreProject({ id: projectId });

    if (!result.ok) {
      return { error: result.error };
    }

    router.refresh();

    return {};
  }, {});

  return (
    <form action={submit} className="flex flex-col items-start gap-2">
      <SubmitButton variant="outline" pendingLabel="Restoring…">
        <RotateCcw />
        Restore
      </SubmitButton>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={state.error} />
        </p>
      ) : undefined}
    </form>
  );
}
