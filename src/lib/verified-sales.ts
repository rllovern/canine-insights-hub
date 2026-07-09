// Verified Sale reads from `ghl_opportunities` — a sale is any opportunity
// with status = 'won' AND whose stage name is exactly "Sold" (case-insensitive),
// bucketed by `won_at`. The stage-name filter is required because GHL configures
// multiple downstream stages (e.g. "In Training", "Finished Training",
// "Sold to Winchester") as won stages, which would otherwise double-count
// opportunities that were sold earlier and simply progressed through training.
// Call Tracking is the only place that keeps reading daily_metrics.verified_sale.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export async function fetchVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (propertyIds && propertyIds.length === 0) return {};

  // Resolve which stage ids count as a "Sold" stage for the properties in scope.
  let stagesQ = supabase
    .from("ghl_pipeline_stages")
    .select("ghl_stage_id, name, property_id")
    .ilike("name", "sold");
  if (propertyIds) stagesQ = stagesQ.in("property_id", propertyIds);
  const stagesRes = await stagesQ;
  if (stagesRes.error) return {};
  const soldStageIds = Array.from(
    new Set(((stagesRes.data ?? []) as { ghl_stage_id: string }[]).map((r) => r.ghl_stage_id).filter(Boolean)),
  );
  if (soldStageIds.length === 0) return {};

  let q = supabase
    .from("ghl_opportunities")
    .select("won_at")
    .eq("status", "won")
    .in("stage_id", soldStageIds)
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