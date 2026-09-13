/**
 * The workflow rule, in one pure module read by both the page (which buttons
 * to render) and the action (which moves to allow), so the two cannot drift
 * apart (spec 0010, key invariants).
 *
 * Status only ever moves forward, plus one reopen step back into review, and
 * `delivered` is final:
 *
 * ```
 * planning ──"Start work"──▶ in_progress ──"Send to review"──▶ in_review ──"Mark delivered" (confirm)──▶ delivered
 *                                 ▲                                  │
 *                                 └────────────"Reopen"──────────────┘
 * ```
 */
import { PROJECT_STATUSES, type ProjectStatus } from "@/db/schema";

export { PROJECT_STATUSES };

export type ProjectMove = {
  readonly to: ProjectStatus;
  readonly label: string;
  /** "Mark delivered" is the one move a person has to confirm before it lands. */
  readonly confirm: boolean;
};

const MOVES: Readonly<Record<ProjectStatus, readonly ProjectMove[]>> = {
  planning: [{ to: "in_progress", label: "Start work", confirm: false }],
  in_progress: [{ to: "in_review", label: "Send to review", confirm: false }],
  in_review: [
    { to: "delivered", label: "Mark delivered", confirm: true },
    { to: "in_progress", label: "Reopen", confirm: false },
  ],
  delivered: [],
};

/** The moves valid right now: none of them while archived, `delivered`'s none otherwise. */
export function nextStatuses(
  status: ProjectStatus,
  archived: boolean,
): readonly ProjectMove[] {
  return archived ? [] : MOVES[status];
}

/** Whether `from` → `to` is one of the moves the workflow allows. */
export function canTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return MOVES[from].some((move) => move.to === to);
}

/**
 * "Overdue" is derived, never stored: a due date in the past, on a project
 * that is neither delivered nor archived. `todayUtc` is a parameter rather
 * than read from the clock in here, so a test can fix it and so every caller
 * agrees on what day it is (spec 0010, Value sourcing).
 */
export function isOverdue(
  dueDate: string | null,
  status: ProjectStatus,
  archivedAt: Date | null,
  todayUtc: string,
): boolean {
  return (
    dueDate !== null &&
    dueDate < todayUtc &&
    status !== "delivered" &&
    archivedAt === null
  );
}

/**
 * The server clock's UTC calendar day, `YYYY-MM-DD`, what "today" means for
 * `isOverdue`. No timezone column exists (spec 0010, Consequences): feature
 * 18's daily overdue sweep should call this same function so the two notions
 * of "today" never disagree.
 */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
