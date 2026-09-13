/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-7, AC-15, AC-18, AC-16
 *
 * `withTenantAction` itself is proven in `src/db/tenant/action.test.ts`; this
 * file exercises what `updateProject` adds: `id` and `clientId` never land in
 * the patch, a blanked field clears rather than being dropped, and a missing
 * row (which includes another agency's id) comes back as `not_found`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Every config handed to `withTenantAction`, so `revalidate` can be pinned (AC-16). */
  configs: [] as Array<{
    readonly name?: string;
    readonly revalidate?: unknown;
  }>,
  update: vi.fn(),
}));

vi.mock("@/db/tenant", async (importActual) => {
  const actual = await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction: (config: {
      readonly name?: string;
      readonly revalidate?: unknown;
      readonly input: { safeParse: (value: unknown) => never };
      readonly handler: (args: {
        readonly input: unknown;
        readonly ctx: unknown;
        readonly db: unknown;
      }) => Promise<unknown>;
    }) => {
      state.configs.push(config);

      return async (rawInput: unknown) => {
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
      };
    },
  };
});

const { updateProject } = await import("./update-project");
const { PROJECT_REVALIDATE } = await import("./revalidate");

const PROJECT_ID = "11111111-1111-7111-8111-111111111111";
const FOREIGN_ID = "99999999-9999-7999-8999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateProject revalidates every project surface (AC-16)", () => {
  it("passes PROJECT_REVALIDATE to withTenantAction", () => {
    const config = state.configs.find(
      (candidate) => candidate.name === "updateProject",
    );

    expect(config?.revalidate).toBe(PROJECT_REVALIDATE);
  });
});

describe("updateProject", () => {
  it("updates the editable fields and returns the id (AC-7)", async () => {
    state.update.mockResolvedValue({ id: PROJECT_ID });

    const result = await updateProject({
      id: PROJECT_ID,
      name: "Renamed",
      description: "",
      dueDate: "2026-05-01",
    });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ name: "Renamed", dueDate: "2026-05-01" }),
    );
    expect(result).toStrictEqual({ ok: true, data: { id: PROJECT_ID } });
  });

  it("never sends id or clientId as part of the patch", async () => {
    state.update.mockResolvedValue({ id: PROJECT_ID });

    await updateProject({
      id: PROJECT_ID,
      name: "Renamed",
      description: "",
      dueDate: "",
    });

    const patch = state.update.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("clientId");
  });

  it("sends an explicit null, not a dropped key, for a cleared due date (AC-7)", async () => {
    state.update.mockResolvedValue({ id: PROJECT_ID });

    await updateProject({
      id: PROJECT_ID,
      name: "Renamed",
      description: "",
      dueDate: "",
    });

    const patch = state.update.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.hasOwn(patch, "dueDate")).toBe(true);
    expect(patch.dueDate).toBeNull();
    expect(Object.hasOwn(patch, "description")).toBe(true);
    expect(patch.description).toBeNull();
  });

  it("returns not_found when zero rows matched, the same outcome a foreign agency's id gets (AC-15)", async () => {
    state.update.mockResolvedValue(undefined);

    const result = await updateProject({
      id: FOREIGN_ID,
      name: "Renamed",
      description: "",
      dueDate: "",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("returns a validation error for an id that is not a uuid, rather than reaching the database", async () => {
    const result = await updateProject({
      id: "not-a-uuid",
      name: "Renamed",
      description: "",
      dueDate: "",
    });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("never updates when the name is blank", async () => {
    const result = await updateProject({
      id: PROJECT_ID,
      name: "   ",
      description: "",
      dueDate: "",
    });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("succeeds for an archived project too, since archiving does not freeze these fields (AC-7)", async () => {
    state.update.mockResolvedValue({ id: PROJECT_ID });

    const result = await updateProject({
      id: PROJECT_ID,
      name: "Still archived",
      description: "",
      dueDate: "",
    });

    expect(result.ok).toBe(true);
  });
});
