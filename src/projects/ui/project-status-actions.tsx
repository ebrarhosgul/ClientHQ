"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ProjectStatus } from "@/db/schema";
import type { ActionError } from "@/db/tenant";
import { ActionErrorMessage } from "@/ui/patterns/action-error";
import { ConfirmDialog } from "@/ui/patterns/confirm-dialog";
import { Button } from "@/ui/primitives/button";
import { SubmitButton } from "@/ui/primitives/submit-button";

import { transitionProject } from "../transition-project";
import { nextStatuses, type ProjectMove } from "../status";

type MoveButtonProps = {
  readonly projectId: string;
  readonly from: ProjectStatus;
  readonly move: ProjectMove;
  /**
   * Called after every result, success or conflict alike, with the error when
   * there was one. The parent owns the message and the refresh: a button
   * cannot hold either, because the refresh that follows a conflict brings
   * back a different set of moves and unmounts the button that was clicked
   * (spec 0010, AC-9).
   */
  readonly onDone: (error?: ActionError) => void;
};

/** A move with no confirmation: "Start work", "Send to review", "Reopen". */
function PlainMoveButton({ projectId, from, move, onDone }: MoveButtonProps) {
  return (
    <form
      action={async () => {
        const result = await transitionProject({
          id: projectId,
          from,
          to: move.to,
        });

        onDone(result.ok ? undefined : result.error);
      }}
    >
      <SubmitButton variant="outline" pendingLabel="Working…">
        {move.label}
      </SubmitButton>
    </form>
  );
}

/** The one confirmed move: "Mark delivered". */
function ConfirmedMoveButton({
  projectId,
  from,
  move,
  onDone,
}: MoveButtonProps) {
  return (
    <ConfirmDialog
      trigger={<Button>{move.label}</Button>}
      title="Mark this project as delivered?"
      description="Delivered is final. You can archive it later, but it cannot go back to review."
      confirmLabel="Mark delivered"
      pendingLabel="Marking delivered…"
      onConfirm={async () => {
        const result = await transitionProject({
          id: projectId,
          from,
          to: move.to,
        });

        onDone(result.ok ? undefined : result.error);

        // Close the dialog either way. A failure is shown beside the buttons
        // by the parent, where it outlives the refresh; the dialog itself
        // would not, because every conflict changes the set of moves.
        return { ok: true };
      }}
    />
  );
}

/**
 * Exactly the buttons `nextStatuses` says are valid right now (spec 0010,
 * AC-8), none while archived. The same pure module the action reads, so the
 * buttons a person sees and the moves the server allows cannot drift apart.
 *
 * The last error sits beside the group rather than inside a button, so the
 * conflict sentence is still on screen once the refresh has replaced the
 * buttons with the fresh set, or removed them all (AC-9).
 */
export function ProjectStatusActions({
  projectId,
  status,
  archived,
}: {
  readonly projectId: string;
  readonly status: ProjectStatus;
  readonly archived: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<ActionError | undefined>(undefined);
  const moves = nextStatuses(status, archived);

  if (moves.length === 0 && error === undefined) {
    return undefined;
  }

  const onDone = (nextError?: ActionError) => {
    setError(nextError);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {moves.length > 0 ? (
        <div
          role="group"
          aria-label="Move this project"
          className="flex flex-wrap items-center gap-2"
        >
          {moves.map((move) =>
            move.confirm ? (
              <ConfirmedMoveButton
                key={move.to}
                projectId={projectId}
                from={status}
                move={move}
                onDone={onDone}
              />
            ) : (
              <PlainMoveButton
                key={move.to}
                projectId={projectId}
                from={status}
                move={move}
                onDone={onDone}
              />
            ),
          )}
        </div>
      ) : undefined}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={error} />
        </p>
      ) : undefined}
    </div>
  );
}
