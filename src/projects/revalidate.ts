/**
 * Every project write revalidates all three surfaces that show one, so the
 * list, the detail page, and the client page's Projects section never show a
 * stale status (spec 0010, AC-16). Shared by every Server Action in this
 * feature rather than repeated at each call site.
 */
import type { RevalidateConfig } from "@/db/tenant";

export const PROJECT_REVALIDATE: RevalidateConfig = {
  paths: [
    "/projects",
    { path: "/projects/[id]", type: "page" },
    { path: "/clients/[id]", type: "page" },
  ],
};
