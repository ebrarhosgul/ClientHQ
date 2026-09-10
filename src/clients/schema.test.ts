/**
 * covers: spec 0006 AC-1, AC-2, AC-3
 *
 * The create and update input schemas: a blank optional field has to pass, a
 * blank or whitespace only name has to fail, and an invalid company email has
 * to fail without touching any other field.
 */
import { describe, expect, it } from "vitest";

import { createClientInput, updateClientInput } from "./schema";

describe("createClientInput", () => {
  it("accepts a name alone, leaving every optional field undefined (AC-1)", () => {
    const result = createClientInput.safeParse({ name: "Northwind Coffee" });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // `toEqual`, not `toStrictEqual`: an absent optional key and one present
    // with value `undefined` are the same outcome here (AC-1), and Zod omits
    // the key entirely rather than setting it.
    expect(result.data).toEqual({
      name: "Northwind Coffee",
      companyEmail: undefined,
      phone: undefined,
      industry: undefined,
      notes: undefined,
      billingAddressLine1: undefined,
      billingAddressLine2: undefined,
      billingCity: undefined,
      billingRegion: undefined,
      billingPostalCode: undefined,
      billingCountry: undefined,
    });
  });

  it("trims the name", () => {
    const result = createClientInput.safeParse({ name: "  Northwind  " });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.name : undefined).toBe("Northwind");
  });

  it("rejects a blank name (AC-2)", () => {
    const result = createClientInput.safeParse({ name: "" });

    expect(result.success).toBe(false);
    expect(
      result.success ? undefined : result.error.flatten().fieldErrors.name,
    ).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("rejects a whitespace only name (AC-2)", () => {
    const result = createClientInput.safeParse({ name: "   " });

    expect(result.success).toBe(false);
  });

  it("rejects a name over 200 characters", () => {
    const result = createClientInput.safeParse({ name: "a".repeat(201) });

    expect(result.success).toBe(false);
  });

  it("accepts a name of exactly 200 characters", () => {
    const result = createClientInput.safeParse({ name: "a".repeat(200) });

    expect(result.success).toBe(true);
  });

  it.each(["", "   "])(
    "treats an optional field of %j as absent rather than failing its own check",
    (blank) => {
      const result = createClientInput.safeParse({
        name: "Acme",
        companyEmail: blank,
        phone: blank,
        industry: blank,
        notes: blank,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.companyEmail).toBeUndefined();
      expect(result.data.phone).toBeUndefined();
    },
  );

  it("lowercases and trims a valid company email (AC-3)", () => {
    const result = createClientInput.safeParse({
      name: "Acme",
      companyEmail: "  Ada@Example.COM  ",
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.companyEmail : undefined).toBe(
      "ada@example.com",
    );
  });

  it("rejects a company email that is not a valid format (AC-3)", () => {
    const result = createClientInput.safeParse({
      name: "Acme",
      companyEmail: "not-an-email",
    });

    expect(result.success).toBe(false);
    expect(
      result.success
        ? undefined
        : result.error.flatten().fieldErrors.companyEmail,
    ).toEqual(expect.arrayContaining([expect.any(String)]));
    // A rejected email leaves the rest of the input alone: only its own field
    // errors, nothing about `name`.
    expect(
      result.success ? undefined : result.error.flatten().fieldErrors.name,
    ).toBeUndefined();
  });

  it("rejects a company email over 320 characters", () => {
    const local = "a".repeat(310);
    const result = createClientInput.safeParse({
      name: "Acme",
      companyEmail: `${local}@example.com`,
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["phone", 50],
    ["industry", 200],
    ["notes", 5000],
    ["billingAddressLine1", 200],
    ["billingAddressLine2", 200],
    ["billingCity", 200],
    ["billingRegion", 200],
    ["billingPostalCode", 20],
    ["billingCountry", 200],
  ] as const)("caps %s at %d characters", (field, max) => {
    const tooLong = createClientInput.safeParse({
      name: "Acme",
      [field]: "a".repeat(max + 1),
    });
    const atMax = createClientInput.safeParse({
      name: "Acme",
      [field]: "a".repeat(max),
    });

    expect(tooLong.success).toBe(false);
    expect(atMax.success).toBe(true);
  });
});

describe("updateClientInput", () => {
  const VALID_ID = "11111111-1111-7111-8111-111111111111";

  it("requires a uuid id alongside every client field", () => {
    const result = updateClientInput.safeParse({
      id: VALID_ID,
      name: "Acme",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty id", () => {
    const result = updateClientInput.safeParse({ id: "", name: "Acme" });

    expect(result.success).toBe(false);
  });

  it("rejects an id that is not a uuid, so a malformed link resolves not found rather than a driver error (AC-11)", () => {
    const result = updateClientInput.safeParse({
      id: "not-a-uuid",
      name: "Acme",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a blank name the same way createClientInput does (AC-2)", () => {
    const result = updateClientInput.safeParse({ id: VALID_ID, name: "  " });

    expect(result.success).toBe(false);
  });

  it("parses a blanked optional field to an explicit null, not undefined, so the patch actually clears the column (AC-7)", () => {
    const result = updateClientInput.safeParse({
      id: VALID_ID,
      name: "Acme",
      companyEmail: "",
      phone: "",
      industry: "",
      notes: "",
      billingAddressLine1: "",
      billingAddressLine2: "",
      billingCity: "",
      billingRegion: "",
      billingPostalCode: "",
      billingCountry: "",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toStrictEqual({
      id: VALID_ID,
      name: "Acme",
      companyEmail: null,
      phone: null,
      industry: null,
      notes: null,
      billingAddressLine1: null,
      billingAddressLine2: null,
      billingCity: null,
      billingRegion: null,
      billingPostalCode: null,
      billingCountry: null,
    });
  });

  it("keeps a provided optional value instead of clearing it", () => {
    const result = updateClientInput.safeParse({
      id: VALID_ID,
      name: "Acme",
      phone: "555-0100",
    });

    expect(result.success).toBe(true);
    expect(result.success ? result.data.phone : undefined).toBe("555-0100");
  });
});
