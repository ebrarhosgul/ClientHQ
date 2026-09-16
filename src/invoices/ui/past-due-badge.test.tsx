/**
 * covers: spec 0012 AC-12, spec 0004 invariant 4
 *
 * `StatusChip` has its own render tests; this is only about what
 * `PastDueBadge` hands it, the word itself never carried by colour alone.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PastDueBadge } from "./past-due-badge";

describe("PastDueBadge", () => {
  it("shows the words Past due, not just a coloured chip (AC-12)", () => {
    render(<PastDueBadge />);

    expect(screen.getByText("Past due")).toBeInTheDocument();
  });

  it("uses the danger tint to reinforce the word", () => {
    render(<PastDueBadge />);

    expect(screen.getByText("Past due")).toHaveAttribute("data-tint", "danger");
  });
});
