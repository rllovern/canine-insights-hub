// Mock data source connector layer.
// Real connectors (Google Ads, CTM, GA4, BigQuery) would implement this same interface.

import { supabase } from "@/integrations/supabase/client";

export type DataSourceId = "google_ads" | "ctm" | "ga4" | "bigquery";

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

export interface DataSourceConnector {
  id: DataSourceId;
  label: string;
  fetchMetrics: (clientId: string, from: string, to: string) => Promise<MetricRow[]>;
}

// Internal Supabase-backed connector (the real "blended" view of mock data)
async function fetchFromDB(clientId: string, from: string, to: string): Promise<MetricRow[]> {
  const { data, error } = await supabase
    .from("daily_metrics")
    .select("*")
    .eq("property_id", clientId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MetricRow[];
}

export const connectors: Record<DataSourceId, DataSourceConnector> = {
  google_ads: { id: "google_ads", label: "Google Ads", fetchMetrics: fetchFromDB },
  ctm: { id: "ctm", label: "Call Tracking Metrics", fetchMetrics: fetchFromDB },
  ga4: { id: "ga4", label: "Google Analytics 4", fetchMetrics: fetchFromDB },
  bigquery: { id: "bigquery", label: "BigQuery (blended)", fetchMetrics: fetchFromDB },
};

export async function fetchBlendedMetrics(clientId: string, from: string, to: string): Promise<MetricRow[]> {
  return fetchFromDB(clientId, from, to);
}

// ============ Calculated fields ============
export const calc = {
  costPerCall: (cost: number, recordCount: number) => (recordCount ? cost / recordCount : 0),
  costPerGoodLead: (cost: number, gl: number) => (gl ? cost / gl : 0),
  costPerBadLead: (cost: number, bl: number) => (bl ? cost / bl : 0),
  costPerLead: (cost: number, leads: number) => (leads ? cost / leads : 0),
  costPerIntake: (cost: number, adm: number) => (adm ? cost / adm : 0),
  ctr: (clicks: number, imp: number) => (imp ? (clicks / imp) * 100 : 0),
  cpc: (cost: number, clicks: number) => (clicks ? cost / clicks : 0),
  cpm: (cost: number, imp: number) => (imp ? (cost / imp) * 1000 : 0),
};
