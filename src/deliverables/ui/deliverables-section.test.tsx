/**
 * covers: spec 0011 AC-1, AC-10, AC-18
 *
 * `UploadDeliverable`, `DeliverableVisibilitySwitch` and
 * `DeleteDeliverableButton` each have their own tests; this file is about
 * `DeliverablesSection`'s own job: showing each row's name, size, type,
 * uploader and date, gating the upload control on an archived project
 * (AC-1) and on storage not being configured (AC-18), an empty state, and a
 * reload prompt when the read failed.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DeliverableRow } from "../queries";
import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

vi.mock("./upload-deliverable", () => ({
  UploadDeliverable: ({ projectId }: { readonly projectId: string }) => (
    <div data-testid="upload-deliverable">upload for {projectId}</div>
  ),
}));

vi.mock("./deliverable-visibility-switch", () => ({
  DeliverableVisibilitySwitch: ({ name }: { readonly name: string }) => (
    <span>switch for {name}</span>
  ),
}));

vi.mock("./delete-deliverable-button", () => ({
  DeleteDeliverableButton: ({ name }: { readonly name: string }) => (
    <button type="button">Delete {name}</button>
  ),
}));

const { DeliverablesSection } = await import("./deliverables-section");

const DELIVERABLES = [
  {
    id: "d1",
    name: "Contract.pdf",
    contentType: "application/pdf",
    sizeBytes: 2_097_152,
    uploadedByName: "Ada Lovelace",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    visibleToClient: false,
  },
  {
    id: "d2",
    name: "Logo.png",
    contentType: "image/png",
    sizeBytes: 512,
    uploadedByName: "Grace Hopper",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
    visibleToClient: true,
  },
] as unknown as readonly DeliverableRow[];

describe("DeliverablesSection", () => {
  it("lists each file's name, type, size, uploader and date (AC-10)", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={DELIVERABLES}
      />,
    );

    expect(screen.getByRole("link", { name: "Contract.pdf" })).toHaveAttribute(
      "href",
      "/deliverables/d1/download",
    );
    expect(screen.getByText(/PDF/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText("switch for Contract.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete Contract.pdf" }),
    ).toBeInTheDocument();
  });

  it("shows the upload control for an active project with storage configured", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={[]}
      />,
    );

    expect(screen.getByTestId("upload-deliverable")).toBeInTheDocument();
  });

  it("hides the upload control and explains why for an archived project (AC-1)", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={true}
        storageConfigured={true}
        deliverables={DELIVERABLES}
      />,
    );

    expect(screen.queryByTestId("upload-deliverable")).not.toBeInTheDocument();
    expect(
      screen.getByText("This project is archived, so no files can be added."),
    ).toBeInTheDocument();
    // Existing files still list either way (AC-1).
    expect(
      screen.getByRole("link", { name: "Contract.pdf" }),
    ).toBeInTheDocument();
  });

  it("hides the upload control and explains why when storage is not configured (AC-18)", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={false}
        deliverables={DELIVERABLES}
      />,
    );

    expect(screen.queryByTestId("upload-deliverable")).not.toBeInTheDocument();
    expect(
      screen.getByText("File storage is not configured for this environment."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Contract.pdf" }),
    ).toBeInTheDocument();
  });

  it("prefers the archived notice over the storage notice when both apply", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={true}
        storageConfigured={false}
        deliverables={[]}
      />,
    );

    expect(
      screen.getByText("This project is archived, so no files can be added."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "File storage is not configured for this environment.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no deliverables", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={[]}
      />,
    );

    expect(screen.getByText("No deliverables yet")).toBeInTheDocument();
  });

  it("shows a reload prompt instead of the list when the read failed", () => {
    render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={undefined}
      />,
    );

    expect(
      screen.getByText("Deliverables could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/projects/p1",
    );
    expect(screen.queryByTestId("upload-deliverable")).not.toBeInTheDocument();
  });
});

describe.each(THEMES)("in the %s theme", (theme) => {
  it("has no axe violation with a list of files", async () => {
    const { container } = render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={DELIVERABLES}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation when empty", async () => {
    const { container } = render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={[]}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation on the storage not configured notice", async () => {
    const { container } = render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={false}
        deliverables={DELIVERABLES}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });

  it("has no axe violation on the reload prompt after a failed read", async () => {
    const { container } = render(
      <DeliverablesSection
        projectId="p1"
        archived={false}
        storageConfigured={true}
        deliverables={undefined}
      />,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
