import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  expectNoAccessibilityViolations,
  THEMES,
  withTheme,
} from "@/ui/test/axe";

import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("ties the label to the control", async () => {
    render(
      <Field name="client-name" label="Client name">
        {(props) => <Input {...props} />}
      </Field>,
    );

    // `getByLabelText` only finds it if the wiring is real.
    expect(screen.getByLabelText("Client name")).toBeInTheDocument();
  });

  it("shows the message beside the field, not only in a toast", () => {
    render(
      <Field name="email" label="Email" error={["Enter an email address."]}>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByText("Enter an email address.")).toBeInTheDocument();
  });

  it("marks the control invalid", () => {
    render(
      <Field name="email" label="Email" error={["Enter an email address."]}>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("points the control at its message", () => {
    render(
      <Field name="email" label="Email" error={["Enter an email address."]}>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Enter an email address.",
    );
  });

  it("announces the message, for someone who has just submitted", () => {
    render(
      <Field name="email" label="Email" error={["Enter an email address."]}>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter an email address.",
    );
  });

  it("joins several messages for the same field", () => {
    render(
      <Field
        name="password"
        label="Password"
        error={["Too short.", "Needs a digit."]}
      >
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too short. Needs a digit.",
    );
  });

  it("reads the description before the error", () => {
    render(
      <Field
        name="email"
        label="Email"
        description="We send invoices here."
        error={["Enter an email address."]}
      >
        {(props) => <Input {...props} />}
      </Field>,
    );

    // A person needs to know what the field is for before being told what is
    // wrong with what they typed.
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "We send invoices here. Enter an email address.",
    );
  });

  it("leaves a valid field unmarked", () => {
    render(
      <Field name="client-name" label="Client name">
        {(props) => <Input {...props} />}
      </Field>,
    );

    const input = screen.getByLabelText("Client name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats an empty error array as no error", () => {
    render(
      <Field name="client-name" label="Client name" error={[]}>
        {(props) => <Input {...props} />}
      </Field>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says required in words as well as with an asterisk", () => {
    render(
      <Field name="client-name" label="Client name" required>
        {(props) => <Input {...props} />}
      </Field>,
    );

    // An asterisk alone is a convention a screen reader does not explain.
    expect(screen.getByLabelText(/Client name/)).toBeRequired();
    expect(screen.getByText("(required)")).toBeInTheDocument();
  });

  it.each(THEMES)("has no axe violation in the %s theme", async (theme) => {
    const { container } = render(
      <>
        <Field name="a" label="Valid" description="Some help.">
          {(props) => <Input {...props} />}
        </Field>
        <Field
          name="b"
          label="Invalid"
          required
          error={["Something is wrong."]}
        >
          {(props) => <Input {...props} />}
        </Field>
      </>,
    );

    await withTheme(theme, () => expectNoAccessibilityViolations(container));
  });
});
