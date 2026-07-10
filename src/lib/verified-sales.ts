// Verified Sale reads from `ghl_opportunities` — GHL Won status is the source
// of truth for a sale, bucketed by `won_at`. Call Tracking is the only place
// that keeps reading daily_metrics.verified_sale.
// Call Tracking is the only place that keeps reading daily_metrics.verified_sale.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export async function fetchVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (propertyIds && propertyIds.length === 0) return {};

  let q = supabase
    .from("ghl_opportunities")
    .select("won_at")
    .eq("status", "won")
    .gte("won_at", `${from}T00:00:00.000Z`)
    .lte("won_at", `${to}T23:59:59.999Z`);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { won_at: string | null }[]) {
    if (!r.won_at) continue;
    const day = r.won_at.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

export function useVerifiedSalesTotal(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["verified-sales-total", propertyIds?.join(",") ?? "all", from, to],
    queryFn: async () => {
      const map = await fetchVerifiedSalesByDate(propertyIds, from, to);
      return Object.values(map).reduce((a, b) => a + b, 0);
    },
  });
}

export function useVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["verified-sales-by-date", propertyIds?.join(",") ?? "all", from, to],
    queryFn: () => fetchVerifiedSalesByDate(propertyIds, from, to),
  });
}

export interface SaleRecord {
  opportunity_id: string;
  property_id: string;
  contact_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string | null;
  won_at: string | null;
  amount: number | null;
}

export async function fetchSaleRecords(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<SaleRecord[]> {
  if (propertyIds && propertyIds.length === 0) return [];

  let q = supabase
    .from("ghl_opportunities")
    .select("id, property_id, contact_id, ghl_created_at, won_at, monetary_value, raw")
    .eq("status", "won")
    .gte("won_at", `${from}T00:00:00.000Z`)
    .lte("won_at", `${to}T23:59:59.999Z`)
    .order("won_at", { ascending: false });
  if (propertyIds) q = q.in("property_id", propertyIds);

  const { data: opps, error } = await q;
  if (error || !opps) return [];

  // Hydrate contact info in batches, scoped by property_id for RLS safety.
  const byProp = new Map<string, Set<string>>();
  for (const o of opps as Array<{ property_id: string; contact_id: string | null }>) {
    if (!o.contact_id) continue;
    if (!byProp.has(o.property_id)) byProp.set(o.property_id, new Set());
    byProp.get(o.property_id)!.add(o.contact_id);
  }

  const contactMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>();
  await Promise.all(
    Array.from(byProp.entries()).map(async ([pid, ids]) => {
      const idList = Array.from(ids);
      if (idList.length === 0) return;
      const { data } = await supabase
        .from("ghl_contacts")
        .select("ghl_contact_id, first_name, last_name, email, phone")
        .eq("property_id", pid)
        .in("ghl_contact_id", idList);
      for (const c of (data ?? []) as Array<{ ghl_contact_id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null }>) {
        contactMap.set(`${pid}:${c.ghl_contact_id}`, c);
      }
    }),
  );

  return (opps as Array<{
    id: string;
    property_id: string;
    contact_id: string | null;
    ghl_created_at: string | null;
    won_at: string | null;
    monetary_value: number | string | null;
    raw: Record<string, unknown> | null;
  }>).map((o) => {
    const c = o.contact_id ? contactMap.get(`${o.property_id}:${o.contact_id}`) : undefined;
    const nameParts = [c?.first_name, c?.last_name].filter(Boolean);
    const rawName = typeof o.raw?.["name"] === "string" ? (o.raw!["name"] as string) : null;
    return {
      opportunity_id: o.id,
      property_id: o.property_id,
      contact_id: o.contact_id,
      name: nameParts.length ? nameParts.join(" ") : rawName,
      phone: c?.phone ?? null,
      email: c?.email ?? null,
      created_at: o.ghl_created_at,
      won_at: o.won_at,
      amount: o.monetary_value == null ? null : Number(o.monetary_value),
    };
  });
}

export function useSaleRecords(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["sale-records", propertyIds?.join(",") ?? "all", from, to],
    queryFn: () => fetchSaleRecords(propertyIds, from, to),
  });
}

/**
 * Trailing 90-day daily revenue run-rate for the given scope, used to derive
 * a pace target on the Revenue Runway chart. Returns dollars-per-day.
 */
export function useRevenueRunRate(propertyIds: string[] | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["revenue-run-rate-90d", propertyIds?.join(",") ?? "all"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 90);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const rows = await fetchSaleRecords(propertyIds, iso(start), iso(end));
      const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
      return total / 90;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The Revenue Runway target period. For `thisMonth` we extend the runway to
 * the last day of the current calendar month so the projection line has room
 * to render. For every other preset we use the visible range as-is.
 */
export function deriveTargetPeriod(range: { from: Date; to: Date }, preset: string): { periodStart: Date; periodEnd: Date } {
  if (preset === "thisMonth") {
    const start = new Date(range.from.getFullYear(), range.from.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(range.from.getFullYear(), range.from.getMonth() + 1, 0, 23, 59, 59, 999);
    return { periodStart: start, periodEnd: end };
  }
  return { periodStart: range.from, periodEnd: range.to };
}

/**
 * Trailing 90-day average won-deal value across the selected scope. Used as
 * the fallback deal-value input for the pipeline-backed revenue forecast.
 */
export function useAvgDealValue(propertyIds: string[] | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["avg-deal-value-90d", propertyIds?.join(",") ?? "all"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 90);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const rows = await fetchSaleRecords(propertyIds, iso(start), iso(end));
      const valid = rows.filter((r) => r.amount != null && r.amount > 0);
      if (valid.length === 0) return 0;
      const total = valid.reduce((s, r) => s + (r.amount ?? 0), 0);
      return total / valid.length;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Count of "available" good leads for the selected scope and period: sum of
 * `daily_metrics.good_leads` across the eligibility window, minus won deals
 * already booked in the same window so nothing is double-counted with the
 * closed-revenue forecast input.
 */
export function useAvailableGoodLeads(
  propertyIds: string[] | null,
  from: string,
  to: string,
  enabled = true,
) {
  return useQuery({
    enabled,
    queryKey: ["available-good-leads", propertyIds?.join(",") ?? "all", from, to],
    queryFn: async () => {
      if (propertyIds && propertyIds.length === 0) return 0;
      let q = supabase
        .from("daily_metrics")
        .select("good_leads")
        .gte("date", from)
        .lte("date", to);
      if (propertyIds) q = q.in("property_id", propertyIds);
      const { data, error } = await q;
      if (error) return 0;
      const good = (data ?? []).reduce((s: number, r: { good_leads: number | null }) => s + (Number(r.good_leads) || 0), 0);
      const wins = await fetchSaleRecords(propertyIds, from, to);
      return Math.max(0, good - wins.length);
    },
  });
}

/**
 * Configurable good-lead close-rate assumption used by the pipeline-backed
 * forecast. Defaults to 30% when a property has no explicit setting. When the
 * scope covers multiple properties, we return the volume-unweighted mean (a
 * good enough v1 approximation).
 */
export function useGoodLeadCloseRate(propertyIds: string[] | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["good-lead-close-rate", propertyIds?.join(",") ?? "all"],
    queryFn: async () => {
      if (propertyIds && propertyIds.length === 0) return 0.3;
      let q = supabase.from("property_settings").select("property_id, good_lead_close_rate");
      if (propertyIds) q = q.in("property_id", propertyIds);
      const { data, error } = await q;
      if (error || !data || data.length === 0) return 0.3;
      const rates = (data as Array<{ good_lead_close_rate: number | null }>)
        .map((r) => Number(r.good_lead_close_rate ?? 0.3))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1);
      if (rates.length === 0) return 0.3;
      return rates.reduce((a, b) => a + b, 0) / rates.length;
    },
    staleTime: 5 * 60 * 1000,
  });
}