export type ReportScope = {
  property_id?: string | null;
  property_name?: string | null;
  date_range?: { from: string; to: string } | null;
  sources_used?: string[];
  sync_freshness?: Record<string, string | null>;
  matching_method?: string;
  caveats?: string[];
};

export type SummaryCard = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
};

export type ChartSpec = {
  type: "bar" | "line" | "area";
  title?: string;
  data: Array<Record<string, string | number | null>>;
  x: string;
  y: string[];
  stacked?: boolean;
};

export type TableSpec = {
  title?: string;
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Array<Record<string, string | number | null>>;
  empty?: string;
};

export type Recommendation = {
  title: string;
  detail?: string;
  severity?: "info" | "warn" | "critical";
};

export type ReportSchema = {
  type: "report";
  title: string;
  subtitle?: string;
  scope: ReportScope;
  summary_cards?: SummaryCard[];
  charts?: ChartSpec[];
  tables?: TableSpec[];
  recommendations?: Recommendation[];
  evidence?: Record<string, unknown>;
};

export function isReportSchema(v: unknown): v is ReportSchema {
  return !!v && typeof v === "object" && (v as { type?: string }).type === "report";
}