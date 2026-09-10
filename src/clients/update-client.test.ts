/**
 * @vitest-environment node
 *
 * covers: spec 0006 AC-6, AC-7, AC-11, AC-14
 *
 * `withTenantAction` itself is proven in `src/db/tenant/action.test.ts`; this
 * file exercises what `updateClient` adds: `id` never lands in the patch, a
 * missing row (which includes another agency's id, AC-11) comes back as
 * `not_found`, and a successful write returns the updated id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  update: vi.fn(),
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
            db: { update: state.update },
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

const { updateClient } = await import("./update-client");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateClient", () => {
  it("updates every editable field and returns the id (AC-7)", async () => {
    state.update.mockResolvedValue({ id: "client-1" });

    const result = await updateClient({
      id: "client-1",
      name: "Renamed Acme",
      companyEmail: "hello@acme.example",
    });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      "client-1",
      expect.objectContaining({
        name: "Renamed Acme",
        companyEmail: "hello@acme.example",
      }),
    );
    expect(result).toStrictEqual({ ok: true, data: { id: "client-1" } });
  });

  it("never sends id as part of the patch", async () => {
    state.update.mockResolvedValue({ id: "client-1" });

    await updateClient({ id: "client-1", name: "Acme" });

    const patch = state.update.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("id");
  });

  it("returns not_found when zero rows matched, the same outcome a foreign agency's id gets (AC-11)", async () => {
    state.update.mockResolvedValue(undefined);

    const result = await updateClient({
      id: "someone-elses-client",
      name: "Acme",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("never updates when the name is blank", async () => {
    const result = await updateClient({ id: "client-1", name: "   " });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("succeeds for an archived client too, since AC-7 allows editing either state", async () => {
    state.update.mockResolvedValue({ id: "client-1" });

    const result = await updateClient({
      id: "client-1",
      name: "Still archived",
    });

    expect(result.ok).toBe(true);
  });
});
