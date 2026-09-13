/**
 * covers: spec 0010 AC-6, AC-17
 *
 * `StatusChip` has its own render tests; this is only about what
 * `OverdueBadge` hands it, the word itself never carried by colour alone.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverdueBadge } from "./overdue-badge";

describe("OverdueBadge", () => {
  it("shows the word Overdue, not just a coloured chip (AC-6, AC-17)", () => {
    render(<OverdueBadge />);

    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });
});
