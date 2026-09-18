// @vitest-environment node
import { describe, expect, it } from "vitest";

import { persistenceFor, reducedUrl } from "./browser";

describe("browser analytics (spec 0019, AC-14, AC-18)", () => {
  it("drops the query string and hash from the captured url", () => {
    expect(reducedUrl("https://app.example.com", "/invoices/1")).toBe(
      "https://app.example.com/invoices/1",
    );
  });

  it("stays in memory until consent is accepted", () => {
    expect(persistenceFor("undecided")).toBe("memory");
    expect(persistenceFor("declined")).toBe("memory");
    expect(persistenceFor("accepted")).toBe("localStorage+cookie");
  });
});
