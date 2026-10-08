// Completion, launch readiness and blockers — three separate measures. Pure, unit-tested.
import { areaOf, type ApplicabilityRule, type SopArea, type SopNode } from "./sopTree";

export type SopStatus =
  | "not_started" | "unknown" | "awaiting_access" | "in_progress"
  | "awaiting_verification" | "verified" | "blocked" | "not_applicable";

export type Readiness = "not_assessed" | "not_ready" | "at_risk" | "launch_ready";

export interface ClientCtx {
  statuses: Record<string, { status: SopStatus; note?: string | null }>;
  auto: Record<string, SopStatus>;
  answers: Record<string, unknown> | null;
  classification?: string | null;
}

export interface Effective {
  status: SopStatus;
  source: "manual" | "auto" | "rule" | "default";
  suggestion?: SopStatus;
}

export const AREAS: SopArea[] = ["discovery", "access", "google_ads", "call_tracking", "website", "launch"];

/** true = applies, false = does not apply, null = cannot tell yet (treated as applicable). */
export function evalRule(rule: ApplicabilityRule | null | undefined, answers: Record<string, unknown> | null): boolean | null {
  if (!rule || !rule.key) return true;
  if (!answers || !(rule.key in answers)) return null;
  const v = answers[rule.key];
  const list = Array.isArray(v) ? v.map(String) : [String(v ?? "")];
  const eq = list.some((x) => x.toLowerCase() === rule.value.toLowerCase());
  switch (rule.op) {
    case "equals": case "includes": return eq;
    case "not_equals": case "not_includes": return !eq;
  }
}

export function effectiveStatus(node: SopNode, ctx: ClientCtx): Effective {
  const manual = ctx.statuses[node.stable_key];
  const auto = ctx.auto[node.stable_key];
  // An explicit status you set always wins; connected data is shown as a suggestion.
  if (manual) {
    return { status: manual.status, source: "manual", suggestion: auto && auto !== manual.status ? auto : undefined };
  }
  if (evalRule(node.applicability_rule, ctx.answers) === false) return { status: "not_applicable", source: "rule" };
  if (auto) return { status: auto, source: "auto" };
  return { status: "not_started", source: "default" };
}

export interface AreaSummary {
  area: SopArea;
  applicable: number;
  verified: number;
  completion: number | null;
  blockers: number;
  criticalOpen: number;
  unknown: number;
  counts: Partial<Record<SopStatus, number>>;
}

export interface Blocker { node: SopNode; status: SopStatus; area: SopArea | null; reason: "blocked" | "critical" }

export interface Summary {
  applicable: number;
  verified: number;
  completion: number | null;
  readiness: Readiness;
  blockers: Blocker[];
  criticalOpen: number;
  byArea: Record<SopArea, AreaSummary>;
  effective: Map<string, Effective>;
}

const RESOLVED: SopStatus[] = ["verified", "not_applicable"];

export function summarize(nodes: SopNode[], ctx: ClientCtx): Summary {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byArea = Object.fromEntries(AREAS.map((a) => [a, { area: a, applicable: 0, verified: 0, completion: null, blockers: 0, criticalOpen: 0, unknown: 0, counts: {} }])) as Record<SopArea, AreaSummary>;
  const effective = new Map<string, Effective>();
  const blockers: Blocker[] = [];
  let applicable = 0, verified = 0, criticalOpen = 0, anyBlocked = false;

  for (const n of nodes) {
    if (n.kind === "section") continue;
    const e = effectiveStatus(n, ctx);
    effective.set(n.stable_key, e);
    const area = areaOf(n, byId);
    const as = area ? byArea[area] : null;
    if (as) as.counts[e.status] = (as.counts[e.status] ?? 0) + 1;
    if (e.status === "not_applicable") continue;
    applicable++; if (as) as.applicable++;
    if (e.status === "verified") { verified++; if (as) as.verified++; continue; }
    if (e.status === "unknown" && as) as.unknown++;
    if (e.status === "blocked") anyBlocked = true;
    const critical = n.is_critical && !RESOLVED.includes(e.status);
    if (critical) { criticalOpen++; if (as) as.criticalOpen++; }
    if (e.status === "blocked" || critical) {
      blockers.push({ node: n, status: e.status, area, reason: e.status === "blocked" ? "blocked" : "critical" });
      if (as) as.blockers++;
    }
  }
  for (const a of AREAS) byArea[a].completion = byArea[a].applicable ? byArea[a].verified / byArea[a].applicable : null;

  let readiness: Readiness;
  const tracked = Object.keys(ctx.statuses).length > 0;
  if (ctx.classification === "legacy" && !tracked) readiness = "not_assessed";
  else if (criticalOpen > 0) readiness = "not_ready";
  else if (anyBlocked) readiness = "at_risk";
  else readiness = "launch_ready";

  // Blocked first, then critical; stable by title.
  blockers.sort((x, y) => (x.status === "blocked" ? 0 : 1) - (y.status === "blocked" ? 0 : 1) || x.node.title.localeCompare(y.node.title));
  return { applicable, verified, completion: applicable ? verified / applicable : null, readiness, blockers, criticalOpen, byArea, effective };
}
