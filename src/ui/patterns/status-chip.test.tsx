import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DELIVERABLE_STATUSES,
  INVOICE_STATUSES,
  PROJECT_STATUSES,
} from "@/db/schema";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import {
  CHIP_TINTS,
  DELIVERABLE_STATUS_PRESENTATION,
  DeliverableStatusChip,
  INVOICE_STATUS_PRESENTATION,
  InvoiceStatusChip,
  PROJECT_STATUS_PRESENTATION,
  ProjectStatusChip,
  StatusChip,
  SUBSCRIPTION_ACCESS_PRESENTATION,
} from "./status-chip";

describe("the tint map covers the real schema", () => {
  it("has a presentation for every invoice status", () => {
    // Read from the schema, not retyped, so adding a status to the database
    // fails here until someone decides how it should look.
    expect(Object.keys(INVOICE_STATUS_PRESENTATION).sort()).toEqual(
      [...INVOICE_STATUSES].sort(),
    );
  });

  it("has a presentation for every project status", () => {
    expect(Object.keys(PROJECT_STATUS_PRESENTATION).sort()).toEqual(
      [...PROJECT_STATUSES].sort(),
    );
  });

  it("has a presentation for every deliverable status", () => {
    expect(Object.keys(DELIVERABLE_STATUS_PRESENTATION).sort()).toEqual(
      [...DELIVERABLE_STATUSES].sort(),
    );
  });

  it("uses only tints the token layer declares", () => {
    const used = [
      ...Object.values(INVOICE_STATUS_PRESENTATION),
      ...Object.values(PROJECT_STATUS_PRESENTATION),
      ...Object.values(DELIVERABLE_STATUS_PRESENTATION),
      ...Object.values(SUBSCRIPTION_ACCESS_PRESENTATION),
    ].map((presentation) => presentation.tint);

    for (const tint of used) {
      expect(CHIP_TINTS).toContain(tint);
    }
  });

  it("gives every status a human label rather than the enum value", () => {
    const all = [
      ...Object.values(INVOICE_STATUS_PRESENTATION),
      ...Object.values(PROJECT_STATUS_PRESENTATION),
      ...Object.values(DELIVERABLE_STATUS_PRESENTATION),
    ];

    for (const { label } of all) {
      // `in_progress` is a database value, not something to show a person.
      expect(label).not.toMatch(/_/);
      expect(label).toMatch(/^[A-Z]/);
    }
  });

  it("says nothing at all when a subscription is in good standing", () => {
    // `full` is deliberately absent: the banner only appears when something is
    // wrong, so there is no chip for the normal case.
    expect(Object.keys(SUBSCRIPTION_ACCESS_PRESENTATION)).not.toContain("full");
  });
});

describe("a chip never relies on its colour", () => {
  it.each(INVOICE_STATUSES)("writes the word for %s", (status) => {
    render(<InvoiceStatusChip status={status} />);

    expect(
      screen.getByText(INVOICE_STATUS_PRESENTATION[status].label),
    ).toBeInTheDocument();
  });

  it.each(PROJECT_STATUSES)("writes the word for %s", (status) => {
    render(<ProjectStatusChip status={status} />);

    expect(
      screen.getByText(PROJECT_STATUS_PRESENTATION[status].label),
    ).toBeInTheDocument();
  });

  it.each(DELIVERABLE_STATUSES)("writes the word for %s", (status) => {
    render(<DeliverableStatusChip status={status} />);

    expect(
      screen.getByText(DELIVERABLE_STATUS_PRESENTATION[status].label),
    ).toBeInTheDocument();
  });

  it("gives void a border, because its tint is the same as draft's", () => {
    // Two neutral chips that mean different things need something other than
    // colour to tell them apart.
    render(<InvoiceStatusChip status="void" />);

    expect(screen.getByText("Void").className).toContain("border");
  });

  it("does not give draft one", () => {
    render(<InvoiceStatusChip status="draft" />);

    expect(screen.getByText("Draft").className).not.toContain("border-border");
  });
});

describe("styling", () => {
  it.each(CHIP_TINTS)(
    "gives %s an explicit foreground and background pair",
    (tint) => {
      render(<StatusChip tint={tint}>Label</StatusChip>);

      const chip = screen.getByText("Label");
      expect(chip.className).toContain(`bg-chip-${tint}`);
      expect(chip.className).toContain(`text-chip-${tint}-foreground`);
    },
  );

  it.each(CHIP_TINTS)("exposes the tint for a test to read on %s", (tint) => {
    render(<StatusChip tint={tint}>Label</StatusChip>);

    expect(screen.getByText("Label")).toHaveAttribute("data-tint", tint);
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation across every chip", async () => {
    const { container } = render(
      <div>
        {INVOICE_STATUSES.map((status) => (
          <InvoiceStatusChip key={status} status={status} />
        ))}
        {PROJECT_STATUSES.map((status) => (
          <ProjectStatusChip key={status} status={status} />
        ))}
        {DELIVERABLE_STATUSES.map((status) => (
          <DeliverableStatusChip key={status} status={status} />
        ))}
      </div>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
