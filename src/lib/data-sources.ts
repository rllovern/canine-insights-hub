import { supabase } from "@/integrations/supabase/client";

export interface MetricRow {
  id: string;
  property_id: string;
  date: string;
  ad_source: string;
  campaign: string;
  cost: number;
  impressions: number;
  clicks: number;
  record_count: number;
  no_entry: number;
  leads: number;
  good_leads: number;
  bad_leads: number;
  medicaid: number;
  spam: number;
  admissions: number;
  sessions: number;
  users: number;
}

export async function fetchBlendedMetrics(propertyId: string | null, from: string, to: string, propertyIds?: string[] | null): Promise<MetricRow[]> {
  if (propertyIds && propertyIds.length === 0) return [];
  let query = supabase
    .from("daily_metrics")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (propertyIds) query = query.in("property_id", propertyIds);
  else if (propertyId) query = query.eq("property_id", propertyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as MetricRow[];
}

export const calc = {
  costPerCall: (cost: number, n: number) => (n ? cost / n : 0),
  costPerGoodLead: (cost: number, gl: number) => (gl ? cost / gl : 0),
  costPerBadLead: (cost: number, bl: number) => (bl ? cost / bl : 0),
  costPerLead: (cost: number, leads: number) => (leads ? cost / leads : 0),
  costPerIntake: (cost: number, adm: number) => (adm ? cost / adm : 0),
  ctr: (clicks: number, imp: number) => (imp ? (clicks / imp) * 100 : 0),
  cpc: (cost: number, clicks: number) => (clicks ? cost / clicks : 0),
  cpm: (cost: number, imp: number) => (imp ? (cost / imp) * 1000 : 0),
};
