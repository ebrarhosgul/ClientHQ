/**
 * The wired list `/api/cron/daily` hands to the runner: the six sweeps in
 * order, with their live gateways (spec 0017, Build plan).
 *
 * The first five are wired so far; the last milestone appends retention.
 */
import { liveClerkListGateway } from "@/auth/clerk";
import { clerkReconcileSweep } from "@/auth/reconcile";
import { expiredInvitesSweep } from "@/contacts/expired-invites-sweep";
import { abandonedUploadsSweep } from "@/deliverables/abandoned-sweep";
import { overdueInvoicesSweep } from "@/invoices/overdue-sweep";
import { liveStripeListGateway } from "@/payments/gateway";
import { stripeReconcileSweep } from "@/payments/reconcile";
import { objectStorage } from "@/storage";

import type { Sweep } from "./sweep";

export const DAILY_SWEEPS: readonly Sweep[] = [
  overdueInvoicesSweep,
  abandonedUploadsSweep(objectStorage()),
  expiredInvitesSweep,
  stripeReconcileSweep(liveStripeListGateway()),
  clerkReconcileSweep(liveClerkListGateway()),
];
