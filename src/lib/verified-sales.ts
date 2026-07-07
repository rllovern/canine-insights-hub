// Verified Sale reads from `sheet_sales` (Google Sheets import), NOT from
// daily_metrics.verified_sale. Call Tracking is the only place that keeps
// reading daily_metrics.verified_sale.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export async function fetchVerifiedSalesByDate(
  propertyIds: string[] | null,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  if (propertyIds && propertyIds.length === 0) return {};
  let q = supabase
    .from("sheet_sales")
    .select("sale_date")
    .gte("sale_date", from)
    .lte("sale_date", to);
  if (propertyIds) q = q.in("property_id", propertyIds);
  const { data, error } = await q;
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { sale_date: string }[]) {
    out[r.sale_date] = (out[r.sale_date] ?? 0) + 1;
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