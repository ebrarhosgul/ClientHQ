/**
 * covers: spec 0005 AC-12, AC-15
 *
 * The panel that proves the whole thread works: the agency name, the role and
 * the currency, exactly as the page hands them in. No query and no branching
 * of its own, so this is a render and read check rather than a behavioural one.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgencyWelcome } from "./agency-welcome";

describe("AgencyWelcome", () => {
  it("names the agency in its heading (AC-15)", () => {
    render(<AgencyWelcome name="Northwind" role="admin" currency="USD" />);

    expect(
      screen.getByRole("heading", { name: "Northwind" }),
    ).toBeInTheDocument();
  });

  it("shows Admin for the admin role (AC-12)", () => {
    render(<AgencyWelcome name="Northwind" role="admin" currency="USD" />);

    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("shows Member for every other role (AC-12)", () => {
    render(<AgencyWelcome name="Northwind" role="member" currency="USD" />);

    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("shows the invoice currency", () => {
    render(<AgencyWelcome name="Northwind" role="admin" currency="EUR" />);

    expect(screen.getByText("EUR")).toBeInTheDocument();
  });
});
