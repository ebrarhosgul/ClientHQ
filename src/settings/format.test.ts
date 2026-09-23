/**
 * @vitest-environment node
 *
 * The rules for a half filled address and for a currency label.
 */
import { describe, expect, it } from "vitest";

import { addressLines, currencyLabel } from "./format";

const EMPTY = {
  addressLine1: undefined,
  addressLine2: undefined,
  city: undefined,
  region: undefined,
  postalCode: undefined,
  country: undefined,
};

describe("addressLines", () => {
  it("prints a full address in postal order", () => {
    expect(
      addressLines({
        addressLine1: "500 Howard Street",
        addressLine2: "Floor 6",
        city: "San Francisco",
        region: "CA",
        postalCode: "94105",
        country: "United States",
      }),
    ).toEqual([
      "500 Howard Street",
      "Floor 6",
      "San Francisco, CA 94105",
      "United States",
    ]);
  });

  it("is empty when nothing is set, so the page can say so", () => {
    expect(addressLines(EMPTY)).toEqual([]);
  });

  it("leaves out what is missing without stray commas", () => {
    expect(addressLines({ ...EMPTY, city: "Austin", country: "US" })).toEqual([
      "Austin",
      "US",
    ]);
    expect(
      addressLines({ ...EMPTY, region: "TX", postalCode: "78701" }),
    ).toEqual(["TX 78701"]);
    expect(
      addressLines({ ...EMPTY, city: "Austin", postalCode: "78701" }),
    ).toEqual(["Austin, 78701"]);
  });

  it("treats blank and whitespace only values as not set", () => {
    expect(
      addressLines({
        ...EMPTY,
        addressLine1: "   ",
        city: "",
        country: " US ",
      }),
    ).toEqual(["US"]);
  });
});

describe("currencyLabel", () => {
  it("names a currency the runtime knows", () => {
    expect(currencyLabel("USD")).toBe("US Dollar (USD)");
  });

  it("falls back to the bare code for one it cannot name", () => {
    expect(currencyLabel("XYZ")).toBe("XYZ");
  });

  it("falls back to the bare code for a value that is not a code at all", () => {
    expect(currencyLabel("not a code")).toBe("not a code");
  });
});
