/**
 * covers: spec 0009 AC-13, AC-14
 *
 * `ContactsSectionView` and `listContacts` each have their own tests. This
 * file is about `ContactsSection`'s own job: it feeds the view from the
 * scoped read, and a failed read is contained here as a reload prompt rather
 * than taking the client page down, except a tenant resolution failure, which
 * belongs to the layout and must still propagate.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agencyContext: vi.fn(),
  listContacts: vi.fn(),
}));

vi.mock("@/auth/context", () => ({ agencyContext: mocks.agencyContext }));
vi.mock("@/contacts/queries", () => ({ listContacts: mocks.listContacts }));
vi.mock("./contacts-section-view", () => ({
  ContactsSectionView: ({
    contacts,
  }: {
    readonly contacts: readonly unknown[];
  }) => (
    <section aria-label="Contacts view">{contacts.length} contacts</section>
  ),
}));

const { ContactsSection } = await import("./contacts-section");

const CLIENT = { id: "client-1", name: "Northwind Coffee", archivedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agencyContext.mockResolvedValue({ orgId: "org-1" });
});

describe("ContactsSection", () => {
  it("renders the view with the contacts it read", async () => {
    mocks.listContacts.mockResolvedValue([{ id: "c1" }, { id: "c2" }]);

    render(await ContactsSection({ client: CLIENT }));

    expect(mocks.listContacts).toHaveBeenCalledWith(
      { orgId: "org-1" },
      "client-1",
    );
    expect(screen.getByText("2 contacts")).toBeInTheDocument();
  });

  it("shows a reload prompt instead of the view when the read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listContacts.mockRejectedValue(new Error("connection reset"));

    render(await ContactsSection({ client: CLIENT }));

    expect(
      screen.getByText("Contacts could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reload" })).toHaveAttribute(
      "href",
      "/clients/client-1",
    );
    expect(screen.queryByLabelText("Contacts view")).not.toBeInTheDocument();

    errorSpy.mockRestore();
  });

  it("lets a tenant resolution failure propagate to the layout", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const resolutionFailure = Object.assign(new Error("no session"), {
      name: "TenantResolutionError",
    });
    mocks.listContacts.mockRejectedValue(resolutionFailure);

    await expect(ContactsSection({ client: CLIENT })).rejects.toThrow(
      resolutionFailure,
    );

    errorSpy.mockRestore();
  });
});
