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

export async function fetchBlendedMetrics(propertyId: string, from: string, to: string): Promise<MetricRow[]> {
  const { data, error } = await supabase
    .from("daily_metrics")
    .select("*")
    .eq("property_id", propertyId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
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
