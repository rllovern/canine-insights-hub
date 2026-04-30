export type AppRole = "internal" | "viewer";

export type DataSource = "google_ads" | "ctm" | "ga4";

export interface Property {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  timezone: string;
  is_active: boolean;
  public_report_token: string | null;
  created_at: string;
}

export interface PropertyDataSource {
  id: string;
  property_id: string;
  source: DataSource;
  is_connected: boolean;
  config: Record<string, unknown> | null;
  last_synced_at: string | null;
}

export interface DateRange {
  from: Date;
  to: Date;
  label: string;
}