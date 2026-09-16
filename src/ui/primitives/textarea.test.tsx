import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("caps its width so field-sizing-content cannot grow past its container", () => {
    // A textarea with no spaces to wrap on (a long reason, an unbroken code)
    // otherwise grows to fit the whole line unwrapped, since field-sizing:
    // content sizes to content unless an explicit max-width clamps it. That
    // clamp needs a definite width the whole way up, which is why the dialog
    // grid also carries `grid-cols-1` (see primitives.test.tsx, "the dialog").
    render(<Textarea aria-label="Reason" />);

    expect(screen.getByRole("textbox").className).toMatch(/\bmax-w-full\b/);
  });
});
