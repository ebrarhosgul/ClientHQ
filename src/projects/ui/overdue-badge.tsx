import { StatusChip } from "@/ui/patterns/status-chip";

/**
 * "Overdue" is never colour alone (spec 0004, invariant 4): the word always
 * shows, the danger tint only reinforces it (spec 0010, design.md status
 * tints).
 */
export function OverdueBadge() {
  return <StatusChip tint="danger">Overdue</StatusChip>;
}
