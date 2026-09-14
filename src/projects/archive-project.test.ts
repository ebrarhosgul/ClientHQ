/**
 * @vitest-environment node
 *
 * covers: spec 0010 AC-11, AC-12, AC-16
 *
 * The refusal mechanism is `withTenantAction`'s job, proven in
 * `src/db/tenant/action.test.ts` and `guards.test.ts`. What that cannot prove
 * is that these two actions opt into it, so the mock below keeps every config
 * it is handed and runs the real role guard on it: `requireRole: "admin"` is
 * asserted on both actions, and a member calling either gets `forbidden`
 * before the handler runs (AC-12). The rest of the file exercises the
 * idempotency both actions promise: archiving an already archived project, or
 * restoring an already active one, succeeds with no error and no write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionConfig } from "@/db/tenant";

import { PROJECT_REVALIDATE } from "./revalidate";

type CapturedConfig = Pick<
  ActionConfig<never, unknown>,
  "name" | "requireRole" | "revalidate"
>;

const state = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  /** The Clerk claim the wrapper would read. Admin unless a test says otherwise. */
  role: "admin" as "admin" | "member",
  /** Every config handed to `withTenantAction`, in registration order. */
  configs: [] as Array<{
    readonly name?: string;
    readonly requireRole?: "admin" | "staff";
    readonly revalidate?: unknown;
  }>,
}));

vi.mock("@/db/tenant", async (importActual) => {
  // Annotated explicitly: TypeScript needs that to call an assertion function.
  const actual: typeof import("@/db/tenant") =
    await importActual<typeof import("@/db/tenant")>();

  return {
    ...actual,
    withTenantAction: (config: {
      readonly name?: string;
      readonly requireRole?: "admin" | "staff";
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
        const ctx = {
          kind: "staff" as const,
          orgId: "org-1",
          clerkOrgId: "clerk-org-1",
          userId: "user-1",
          clerkUserId: "clerk-user-1",
          role: state.role,
        };

        // The wrapper's own dispatch, verbatim, on the real guards: the
        // config decides which guard runs, and the guard decides the outcome.
        try {
          if (config.requireRole === "admin") {
            actual.requireAdmin(ctx);
          } else {
            actual.requireStaff(ctx);
          }
        } catch (thrown) {
          if (actual.isTenantActionError(thrown)) {
            return { ok: false, error: thrown.error };
          }

          throw thrown;
        }

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
            ctx,
            db: { findById: state.findById, update: state.update },
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

const { archiveProject, restoreProject } = await import("./archive-project");

const PROJECT_ID = "11111111-1111-7111-8111-111111111111";
const MISSING_ID = "99999999-9999-7999-8999-999999999999";

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
});

function configOf(name: string): CapturedConfig {
  const config = state.configs.find((candidate) => candidate.name === name);

  if (config === undefined) {
    throw new Error(`${name} was never registered with withTenantAction`);
  }

  return config as CapturedConfig;
}

describe("both actions are admin only (AC-12)", () => {
  it.each(["archiveProject", "restoreProject"])(
    '%s is registered with requireRole: "admin"',
    (name) => {
      expect(configOf(name).requireRole).toBe("admin");
    },
  );

  it.each([
    ["archiveProject", archiveProject],
    ["restoreProject", restoreProject],
  ] as const)(
    "%s refuses a member with forbidden, before the handler reads anything",
    async (_name, action) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      state.role = "member";

      const result = await action({ id: PROJECT_ID });

      expect(result).toStrictEqual({
        ok: false,
        error: { code: "forbidden", message: expect.any(String) },
      });
      expect(state.findById).not.toHaveBeenCalled();
      expect(state.update).not.toHaveBeenCalled();
      // The refusal is logged once, as the wrapper's own tests promise.
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
    },
  );
});

describe("both actions revalidate every project surface (AC-16)", () => {
  it.each(["archiveProject", "restoreProject"])(
    "%s passes PROJECT_REVALIDATE",
    (name) => {
      expect(configOf(name).revalidate).toBe(PROJECT_REVALIDATE);
    },
  );
});

describe("archiveProject", () => {
  it("returns not_found for a missing id, the same outcome a foreign agency's id gets", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await archiveProject({ id: MISSING_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("archives an active project from any status, keeping the status (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "in_review",
      archivedAt: null,
    });
    const archivedAt = new Date("2026-01-01T00:00:00.000Z");
    state.update.mockResolvedValue({ id: PROJECT_ID, archivedAt });

    const result = await archiveProject({ id: PROJECT_ID });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ archivedAt: expect.any(Date) }),
    );
    expect(state.update.mock.calls[0][2]).not.toHaveProperty("status");
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });

  it("succeeds with no write when the project is already archived (AC-11)", async () => {
    const archivedAt = new Date("2025-06-01T00:00:00.000Z");
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt,
    });

    const result = await archiveProject({ id: PROJECT_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt } });
  });
});

describe("restoreProject", () => {
  it("returns not_found for a missing id", async () => {
    state.findById.mockResolvedValue(undefined);

    const result = await restoreProject({ id: MISSING_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("not_found");
  });

  it("restores an archived project, clearing archived_at (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt: new Date("2025-06-01T00:00:00.000Z"),
    });
    state.update.mockResolvedValue({ id: PROJECT_ID, archivedAt: null });

    const result = await restoreProject({ id: PROJECT_ID });

    expect(state.update).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      expect.objectContaining({ archivedAt: null }),
    );
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });

  it("succeeds with no write when the project is already active (AC-11)", async () => {
    state.findById.mockResolvedValue({
      id: PROJECT_ID,
      status: "planning",
      archivedAt: null,
    });

    const result = await restoreProject({ id: PROJECT_ID });

    expect(state.update).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ ok: true, data: { archivedAt: null } });
  });
});
