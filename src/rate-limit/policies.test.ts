/**
 * covers: spec 0018 AC-1
 *
 * The three ceilings are `as const` literals, not configuration, and
 * nothing else in the suite pins their exact numbers: the door tests drive
 * off `UPLOAD.limit` itself and would still pass if a limit quietly
 * changed. This is the one place that checks the literal values.
 */
import { describe, expect, it } from "vitest";

import { CREATE_AGENCY, INVOICE_EMAIL, UPLOAD } from "./policies";

describe("the three named policies", () => {
  it("UPLOAD allows 60 an hour", () => {
    expect(UPLOAD).toStrictEqual({
      action: "upload",
      limit: 60,
      windowSeconds: 3600,
    });
  });

  it("INVOICE_EMAIL allows 50 a day, shared by issue and resend", () => {
    expect(INVOICE_EMAIL).toStrictEqual({
      action: "invoice_email",
      limit: 50,
      windowSeconds: 86400,
    });
  });

  it("CREATE_AGENCY allows 3 a day, keyed per person", () => {
    expect(CREATE_AGENCY).toStrictEqual({
      action: "create_agency",
      limit: 3,
      windowSeconds: 86400,
    });
  });
});
