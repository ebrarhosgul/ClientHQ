/**
 * @vitest-environment node
 *
 * covers: spec 0006 AC-1, AC-2, AC-3, AC-10
 *
 * `withTenantAction` itself (parsing, role guard, error mapping) is already
 * proven in `src/db/tenant/action.test.ts`; this file only exercises what
 * `createClient` adds on top of that wrapper: which fields land on the insert,
 * and that a validation failure never reaches `db.insert` at all. The fake
 * wrapper below reproduces just enough of the real one (parse, call the
 * handler, map a thrown `TenantActionError`) to isolate that, using the real
 * `tenantActionError`/`isTenantActionError` so the mapping itself stays true
 * to the real implementation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  insert: vi.fn(),
}));

vi.mock("@/db/tenant", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction:
      (config: {
        readonly input: { safeParse: (value: unknown) => never };
        readonly handler: (args: {
          readonly input: unknown;
          readonly ctx: unknown;
          readonly db: unknown;
        }) => Promise<unknown>;
      }) =>
      async (rawInput: unknown) => {
        const parsed = config.input.safeParse(rawInput) as
          | { success: true; data: unknown }
          | {
              success: false;
              error: { flatten: () => { fieldErrors: unknown } };
            };

        if (!parsed.success) {
          return {
            ok: false,
            error: {
              code: "validation",
              message: "Some of that is not right yet.",
              fieldErrors: parsed.error.flatten().fieldErrors,
            },
          };
        }

        try {
          const data = await config.handler({
            input: parsed.data,
            ctx: { orgId: "org-1" },
            db: { insert: state.insert },
          });

          return { ok: true, data };
        } catch (thrown) {
          if (actual.isTenantActionError(thrown)) {
            return { ok: false, error: thrown.error };
          }

          throw thrown;
        }
      },
  };
});

const { createClient } = await import("./create-client");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createClient", () => {
  it("creates a client from just a name, leaving every other field undefined (AC-1)", async () => {
    state.insert.mockResolvedValue({ id: "client-1" });

    const result = await createClient({ name: "Northwind Coffee" });

    expect(state.insert).toHaveBeenCalledTimes(1);
    expect(state.insert.mock.calls[0][1]).toStrictEqual({
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
    expect(result).toStrictEqual({ ok: true, data: { id: "client-1" } });
  });

  it("passes every field through to the insert when they are all filled in", async () => {
    state.insert.mockResolvedValue({ id: "client-2" });

    await createClient({
      name: "Harbour Books",
      companyEmail: "Billing@Harbour.example",
      phone: "555-0100",
      industry: "Retail",
      notes: "Prefers email",
      billingAddressLine1: "1 Harbour Way",
      billingAddressLine2: "Suite 4",
      billingCity: "Portland",
      billingRegion: "OR",
      billingPostalCode: "97201",
      billingCountry: "USA",
    });

    expect(state.insert.mock.calls[0][1]).toStrictEqual({
      name: "Harbour Books",
      companyEmail: "billing@harbour.example",
      phone: "555-0100",
      industry: "Retail",
      notes: "Prefers email",
      billingAddressLine1: "1 Harbour Way",
      billingAddressLine2: "Suite 4",
      billingCity: "Portland",
      billingRegion: "OR",
      billingPostalCode: "97201",
      billingCountry: "USA",
    });
  });

  it("never inserts when the name is blank (AC-2)", async () => {
    const result = await createClient({ name: "   " });

    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("never inserts when the company email is not a valid format (AC-3)", async () => {
    const result = await createClient({
      name: "Acme",
      companyEmail: "not-an-email",
    });

    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(
      result.ok ? undefined : result.error.fieldErrors?.companyEmail,
    ).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("never stamps org_id or id from the input (AC-10)", async () => {
    state.insert.mockResolvedValue({ id: "client-1" });

    await createClient({ name: "Acme" });

    const values = state.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(values).not.toHaveProperty("orgId");
    expect(values).not.toHaveProperty("id");
  });
});
