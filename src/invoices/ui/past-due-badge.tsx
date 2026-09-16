import { StatusChip } from "@/ui/patterns/status-chip";

/**
 * "Past due" is never colour alone (spec 0004, invariant 4): the word always
 * shows, the danger tint only reinforces it. Derived by `isPastDue`, never
 * stored: the status stays `sent` until the nightly sweep moves it (spec
 * 0012, AC-12).
 */
export function PastDueBadge() {
  return <StatusChip tint="danger">Past due</StatusChip>;
}
