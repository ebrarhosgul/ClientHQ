"use server";

/**
 * Moving a project through its stages (spec 0010, AC-8 through AC-10).
 *
 * Two checks, in order: `canTransition` first, so an illegal move (skipping a
 * stage, or leaving `delivered`) is refused before any read touches the row;
 * then the write itself is a compare and set, conditional on the status the
 * caller says the button was rendered from and on the project not being
 * archived. A miss on either condition means someone else moved it, or
 * archived it, since the page was rendered — never a wrong write.
 */
import { and, eq, isNull } from "drizzle-orm";

import { projects, type ProjectStatus } from "@/db/schema";
import { tenantActionError, withTenantAction } from "@/db/tenant";
import { PROJECT_STATUS_PRESENTATION } from "@/ui/patterns/status-chip";

import { PROJECT_REVALIDATE } from "./revalidate";
import { transitionProjectInput } from "./schema";
import { canTransition } from "./status";

export type TransitionedProject = {
  readonly status: ProjectStatus;
};

export const transitionProject = withTenantAction({
  name: "transitionProject",
  input: transitionProjectInput,
  revalidate: PROJECT_REVALIDATE,
  handler: async ({ input, db }): Promise<TransitionedProject> => {
    if (!canTransition(input.from, input.to)) {
      throw tenantActionError({
        code: "validation",
        message: `A project cannot move from ${PROJECT_STATUS_PRESENTATION[input.from].label} to ${PROJECT_STATUS_PRESENTATION[input.to].label}.`,
      });
    }

    const row = await db.update(
      projects,
      input.id,
      { status: input.to },
      {
        where: and(
          eq(projects.status, input.from),
          isNull(projects.archivedAt),
        ),
      },
    );

    if (row !== undefined) {
      return { status: row.status };
    }

    // The compare and set missed: find out why, for a message worth reading.
    const current = await db.findById(projects, input.id);

    if (current === undefined) {
      throw tenantActionError({ code: "not_found", message: "" });
    }

    if (current.archivedAt !== null) {
      throw tenantActionError({
        code: "conflict",
        message: "This project is archived.",
      });
    }

    throw tenantActionError({
      code: "conflict",
      message: `This project was already moved to ${PROJECT_STATUS_PRESENTATION[current.status].label}.`,
    });
  },
});
