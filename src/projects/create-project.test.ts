/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-1, AC-2, AC-3, AC-16
 *
 * `withTenantAction` itself is proven in `src/db/tenant/action.test.ts`; this
 * file exercises what `createProject` adds: the client lookup gate, and that
 * every project starts in `planning` with no way to smuggle a different
 * status in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** Every config handed to `withTenantAction`, so `revalidate` can be pinned (AC-16). */
  configs: [] as Array<{
    readonly name?: string;
    readonly revalidate?: unknown;
  }>,
  findById: vi.fn(),
  insert: vi.fn(),
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
            db: { findById: state.findById, insert: state.insert },
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

const { createProject } = await import("./create-project");
const { PROJECT_REVALIDATE } = await import("./revalidate");

const CLIENT_ID = "11111111-1111-7111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProject revalidates every project surface (AC-16)", () => {
  it("passes PROJECT_REVALIDATE to withTenantAction", () => {
    const config = state.configs.find(
      (candidate) => candidate.name === "createProject",
    );

    expect(config?.revalidate).toBe(PROJECT_REVALIDATE);
  });
});

describe("createProject", () => {
  it("creates a project under an active client, description and due date absent (AC-1)", async () => {
    state.findById.mockResolvedValue({ id: CLIENT_ID, archivedAt: null });
    state.insert.mockResolvedValue({ id: "project-1" });

    const result = await createProject({
      clientId: CLIENT_ID,
      name: "Website relaunch",
    });

    expect(state.insert.mock.calls[0][1]).toStrictEqual({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      description: undefined,
      dueDate: undefined,
    });
    expect(result).toStrictEqual({ ok: true, data: { id: "project-1" } });
  });

  it("never accepts a status field, even if one is smuggled into the raw input", async () => {
    state.findById.mockResolvedValue({ id: CLIENT_ID, archivedAt: null });
    state.insert.mockResolvedValue({ id: "project-1" });

    await createProject({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      status: "delivered",
    });

    const values = state.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(values).not.toHaveProperty("status");
  });

  it("refuses with not_found when the client is archived (AC-3)", async () => {
    state.findById.mockResolvedValue({
      id: CLIENT_ID,
      archivedAt: new Date(),
    });

    const result = await createProject({
      clientId: CLIENT_ID,
      name: "Website relaunch",
    });

    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("refuses with not_found when the client id does not resolve in this agency (AC-3)", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await createProject({
      clientId: CLIENT_ID,
      name: "Website relaunch",
    });

    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("never inserts when the name is blank (AC-2)", async () => {
    const result = await createProject({ clientId: CLIENT_ID, name: "   " });

    expect(state.findById).not.toHaveBeenCalled();
    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("validation");
  });

  it("never inserts for an impossible due date (AC-2)", async () => {
    const result = await createProject({
      clientId: CLIENT_ID,
      name: "Website relaunch",
      dueDate: "2026-02-30",
    });

    expect(state.insert).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.fieldErrors?.dueDate).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
  });

  it("never stamps org_id or id from the input", async () => {
    state.findById.mockResolvedValue({ id: CLIENT_ID, archivedAt: null });
    state.insert.mockResolvedValue({ id: "project-1" });

    await createProject({ clientId: CLIENT_ID, name: "Website relaunch" });

    const values = state.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(values).not.toHaveProperty("orgId");
    expect(values).not.toHaveProperty("id");
  });
});
