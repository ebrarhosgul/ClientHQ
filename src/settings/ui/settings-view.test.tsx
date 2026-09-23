/**
 * The read only `/settings` surface: a filled in profile, a new agency with
 * nothing filled in, the no agency state, and axe over all three in both
 * themes. There is no form on this page, so no control is expected.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AgencySettings } from "@/db/tenant";
import {
  THEMES,
  expectNoAccessibilityViolations,
  withTheme,
} from "@/ui/test/axe";

import { SettingsView } from "./settings-view";

const FILLED: AgencySettings = {
  id: "org-1",
  name: "Apex Interactive Studio",
  slug: "apex-interactive-studio",
  defaultCurrency: "USD",
  description: "Digital product and engineering agency.",
  taxId: "US-9482019",
  addressLine1: "500 Howard Street",
  addressLine2: "Floor 6",
  city: "San Francisco",
  region: "CA",
  postalCode: "94105",
  country: "United States",
};

const BARE: AgencySettings = {
  id: "org-2",
  name: "Fresh Agency",
  slug: "fresh-agency",
  defaultCurrency: "EUR",
  description: undefined,
  taxId: undefined,
  addressLine1: undefined,
  addressLine2: undefined,
  city: undefined,
  region: undefined,
  postalCode: undefined,
  country: undefined,
};

describe("SettingsView", () => {
  it("shows the whole profile", () => {
    render(<SettingsView settings={FILLED} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Apex Interactive Studio")).toBeInTheDocument();
    expect(
      screen.getByText("Digital product and engineering agency."),
    ).toBeInTheDocument();
    expect(screen.getByText("US-9482019")).toBeInTheDocument();
    expect(screen.getByText("US Dollar (USD)")).toBeInTheDocument();
    expect(screen.getByText("500 Howard Street")).toBeInTheDocument();
    expect(screen.getByText("San Francisco, CA 94105")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });

  it("is read only: no form, no field and no button", () => {
    render(<SettingsView settings={FILLED} />);

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
  });

  it("says Not set, in words, for every empty value", () => {
    render(<SettingsView settings={BARE} />);

    // About, tax ID and address.
    expect(screen.getAllByText("Not set")).toHaveLength(3);
    expect(screen.getByText("Euro (EUR)")).toBeInTheDocument();
  });

  it("explains itself when there is no agency row to show", () => {
    render(<SettingsView settings={undefined} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it.each([
    ["a filled in profile", FILLED],
    ["a profile with nothing filled in", BARE],
    ["no agency row", undefined],
  ] as const)("has no axe violation for %s", async (_name, settings) => {
    const { container } = render(<SettingsView settings={settings} />);

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
