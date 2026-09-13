"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";

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
  /** Refresh the page after every result, success or conflict alike, so a
   * stale status or a stale set of buttons never lingers (spec 0010, AC-9). */
  readonly onDone: () => void;
};

/** A move with no confirmation: "Start work", "Send to review", "Reopen". */
function PlainMoveButton({ projectId, from, move, onDone }: MoveButtonProps) {
  const [state, submit] = useActionState<
    { readonly error?: ActionError },
    FormData
  >(async () => {
    const result = await transitionProject({
      id: projectId,
      from,
      to: move.to,
    });

    onDone();

    if (!result.ok) {
      return { error: result.error };
    }

    return {};
  }, {});

  return (
    <form action={submit} className="flex flex-col items-start gap-1">
      <SubmitButton variant="outline" pendingLabel="Working…">
        {move.label}
      </SubmitButton>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          <ActionErrorMessage error={state.error} />
        </p>
      ) : undefined}
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

        onDone();

        if (!result.ok) {
          return {
            ok: false,
            message: <ActionErrorMessage error={result.error} />,
          };
        }

        return { ok: true };
      }}
    />
  );
}

/**
 * Exactly the buttons `nextStatuses` says are valid right now (spec 0010,
 * AC-8), none while archived. The same pure module the action reads, so the
 * buttons a person sees and the moves the server allows cannot drift apart.
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
  const moves = nextStatuses(status, archived);

  if (moves.length === 0) {
    return undefined;
  }

  return (
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
            onDone={() => router.refresh()}
          />
        ) : (
          <PlainMoveButton
            key={move.to}
            projectId={projectId}
            from={status}
            move={move}
            onDone={() => router.refresh()}
          />
        ),
      )}
    </div>
  );
}
