/**
 * Every deliverable write revalidates the project page, the only surface
 * that shows the Deliverables section (spec 0011, AC-16).
 */
import type { RevalidateConfig } from "@/db/tenant";

export const DELIVERABLE_REVALIDATE: RevalidateConfig = {
  paths: [{ path: "/projects/[id]", type: "page" }],
};
