/**
 * covers: spec 0019 AC-17, AC-18
 *
 * The banner as a landmark: named, no dialog role, keyboard reachable, two
 * buttons of equal weight, gone in place after either, back after the
 * settings control, absent under `/portal`. The Server Action is stubbed;
 * the cookie it writes is proven by the browser suite.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { ConsentProvider } from "../consent-context";
import type { ConsentState } from "../consent-state";

const state = vi.hoisted(() => ({
  pathname: "/",
  setCookieConsent: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

vi.mock("../consent", () => ({
  setCookieConsent: (choice: ConsentState) => state.setCookieConsent(choice),
}));

const { CookieBanner } = await import("./cookie-banner");
const { CookieSettingsButton } = await import("./cookie-settings");

function renderBanner(initial: ConsentState = "undecided") {
  return render(
    <ConsentProvider initial={initial}>
      <main>
        <h1>Page</h1>
        <CookieSettingsButton />
      </main>
      <CookieBanner />
    </ConsentProvider>,
  );
}

beforeEach(() => {
  state.pathname = "/";
  state.setCookieConsent.mockReset();
  state.setCookieConsent.mockImplementation(async (choice: ConsentState) => ({
    ok: true,
    data: { consent: choice },
  }));
});

describe("CookieBanner", () => {
  it("is a named region, not a dialog, with a privacy link and two buttons", () => {
    renderBanner();

    const region = screen.getByRole("region", { name: "Cookie preferences" });

    expect(region).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "privacy notice" }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("button", { name: "Accept" })).toHaveAttribute(
      "data-variant",
      "outline",
    );
    expect(screen.getByRole("button", { name: "Decline" })).toHaveAttribute(
      "data-variant",
      "outline",
    );
  });

  it("is reachable by keyboard in document order, after the page content", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Cookie settings" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "privacy notice" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Accept" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus();
  });

  it.each(["accepted", "declined"] as const)(
    "writes %s and disappears in place",
    async (choice) => {
      const user = userEvent.setup();
      renderBanner();

      await user.click(
        screen.getByRole("button", {
          name: choice === "accepted" ? "Accept" : "Decline",
        }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("region")).not.toBeInTheDocument();
      });
      expect(state.setCookieConsent).toHaveBeenCalledWith(choice);
    },
  );

  it("does not render once a choice is stored", () => {
    renderBanner("declined");

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("comes back after Cookie settings clears the choice", async () => {
    const user = userEvent.setup();
    renderBanner("accepted");

    await user.click(screen.getByRole("button", { name: "Cookie settings" }));

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Cookie preferences" }),
      ).toBeInTheDocument();
    });
    expect(state.setCookieConsent).toHaveBeenCalledWith("undecided");
  });

  it("stays put and shows the error when the action refuses", async () => {
    const user = userEvent.setup();
    state.setCookieConsent.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "" },
    });
    renderBanner();

    await user.click(screen.getByRole("button", { name: "Accept" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it.each(["/portal", "/portal/invoices/1"])(
    "never renders under %s",
    (path) => {
      state.pathname = path;
      renderBanner();

      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    },
  );

  describe.each(THEMES)("in the %s theme", (theme) => {
    it("has no axe violation", async () => {
      const { container } = renderBanner();

      await withTheme(theme, () => expectNoAccessibilityViolations(container));
    });
  });
});
