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