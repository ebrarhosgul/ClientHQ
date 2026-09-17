/**
 * The wired list `/api/cron/daily` hands to the runner: the six sweeps in
 * order, with their live gateways (spec 0017, Build plan).
 *
 * Only `overdue_invoices` is wired so far; the later milestones append the
 * rest in `SWEEP_ORDER`, each a one line addition here.
 */
import { overdueInvoicesSweep } from "@/invoices/overdue-sweep";

import type { Sweep } from "./sweep";

export const DAILY_SWEEPS: readonly Sweep[] = [overdueInvoicesSweep];
