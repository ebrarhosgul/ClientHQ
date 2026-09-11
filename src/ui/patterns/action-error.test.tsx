/**
 * covers: spec 0008 AC-7
 *
 * The one place a refused write earns a link: `subscription_inactive` points
 * at `/billing`, and no other code does.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ACTION_ERROR_CODES } from "@/db/tenant/errors";

import { ActionErrorMessage } from "./action-error";
import { messageForCode } from "./error-messages";

describe("ActionErrorMessage", () => {
  it("shows the refusal with a link to billing on subscription_inactive", () => {
    render(
      <p role="alert">
        <ActionErrorMessage
          error={{ code: "subscription_inactive", message: "" }}
        />
      </p>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      messageForCode("subscription_inactive"),
    );
    expect(screen.getByRole("link", { name: "Go to billing" })).toHaveAttribute(
      "href",
      "/billing",
    );
  });

  it("prefers the handler's own message when it has one", () => {
    render(
      <p role="alert">
        <ActionErrorMessage
          error={{ code: "subscription_inactive", message: "Pay first." }}
        />
      </p>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Pay first.");
  });

  it.each(
    ACTION_ERROR_CODES.filter((code) => code !== "subscription_inactive"),
  )("links nowhere on %s", (code) => {
    render(
      <p role="alert">
        <ActionErrorMessage error={{ code, message: "" }} />
      </p>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(messageForCode(code));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
