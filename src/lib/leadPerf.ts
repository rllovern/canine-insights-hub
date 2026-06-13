import type { Database } from "@/integrations/supabase/types";

export type CanonicalStage = Database["public"]["Enums"]["ghl_canonical_stage"];

export const CANONICAL_STAGES: CanonicalStage[] = [
  "new",
  "contacted",
  "engaged",
  "appointment",
  "showed",
  "won",
  "lost",
  "ignore",
];

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(Number(seconds))) return "—";
  const s = Math.max(0, Math.round(Number(seconds)));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(s / 86400);
  const h = Math.round((s % 86400) / 3600);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(0)}%`;
}

export function formatPct1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}

/** "X of Y leads" style denominator. */
export function ofDenom(numerator: number | null | undefined, denom: number | null | undefined, noun = "leads"): string {
  const n = Number(numerator ?? 0);
  const d = Number(denom ?? 0);
  return `${n.toLocaleString()} of ${d.toLocaleString()} ${noun}`;
}

/** Compute percent safely. */
export function pctOf(numerator: number | null | undefined, denom: number | null | undefined): number | null {
  const n = Number(numerator ?? 0);
  const d = Number(denom ?? 0);
  if (!d) return null;
  return (n / d) * 100;
}

export function formatNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

/** Issue-type codes accepted by lead_perf_drill. */
export type DrillIssue =
  | "never_responded"
  | "currently_waiting"
  | "stale"
  | "critical_stale"
  | "unassigned"
  | "missing_opportunity"
  | "lost_without_reason"
  | "slow_response"
  | "duplicate_contacts"
  | "duplicate_opportunities"
  | "unknown_response_source"
  | "appointments_missing_status"
  | "unmapped_stages"
  | "disqualified_by_tag";

export const ISSUE_LABEL: Record<DrillIssue, string> = {
  never_responded: "Never responded",
  currently_waiting: "Currently waiting",
  stale: "Stale leads",
  critical_stale: "Critical stale",
  unassigned: "Unassigned",
  missing_opportunity: "Missing opportunity",
  lost_without_reason: "Lost without reason",
  slow_response: "Slow response",
  duplicate_contacts: "Duplicate contacts",
  duplicate_opportunities: "Duplicate opportunities",
  unknown_response_source: "Unknown response source",
  appointments_missing_status: "Appointments missing status",
  unmapped_stages: "Unmapped pipeline stages",
  disqualified_by_tag: "Disqualified by tag",
};

export const WINDOW_TOOLTIP =
  "Lead and contact metrics are scoped to the selected reporting window. They are not lifetime CRM totals.";