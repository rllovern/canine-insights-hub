/* Phase 2 ReportSchema. Backward-compatible with Phase 1:
 * - new fields are optional
 * - old chart shape ("area"/"bar"/"line" with x:string y:string[]) still works
 * - normalizer in ReportView handles alternate shapes
 */

export type Severity = "good" | "warning" | "critical" | "neutral";

export type ReportScope = {
  property_id?: string | null;
  property_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  date_range?: { from: string; to: string } | null;
  sources_used?: string[];
  sync_freshness?: Record<string, string | null>;
  matching_method?: string;
  caveats?: string[];
};

export type ReportStatus = {
  label: string;
  severity: Severity;
  explanation?: string;
};

export type SummaryCard = {
  label: string;
  value: string | number;
  delta?: string | number;
  delta_direction?: "up" | "down" | "flat";
  status?: Severity;
  tone?: "neutral" | "good" | "warn" | "bad"; // legacy
  hint?: string;
  detail?: string;
};

export type ChartType =
  | "bar" | "line" | "area"
  | "stacked_bar" | "donut" | "timeline" | "funnel";

export type ChartSpec = {
  type: ChartType;
  title?: string;
  description?: string;
  data: Array<Record<string, string | number | null>>;
  x: string;
  y: string[];
  stacked?: boolean;
  color_key?: string;
  // legacy aliases the LLM sometimes emits — normalized in ReportView
  x_key?: string;
  xKey?: string;
  y_key?: string;
  series?: Array<{ key: string; label?: string }>;
};

export type TableColumnType =
  | "text" | "number" | "currency" | "percent" | "date" | "badge" | "link";

export type TableColumn = {
  key: string;
  label: string;
  type?: TableColumnType;
  align?: "left" | "right";
};

export type TableSpec = {
  title?: string;
  description?: string;
  columns: TableColumn[];
  rows: Array<Record<string, string | number | null>>;
  default_sort?: { key: string; direction: "asc" | "desc" };
  empty?: string;
};

export type RecommendationAction =
  | "open_queue"
  | "export"
  | "save_report"
  | "create_alert_later"
  | "review_mapping"
  | "resync_later";

export type Recommendation = {
  title: string;
  detail?: string;
  severity?: "info" | "warn" | "critical" | "low" | "medium" | "high";
  action_type?: RecommendationAction;
};

export type EvidenceItem = {
  label: string;
  value: string | number;
  source?: string;
  caveat?: string;
};

export type ReportConfidence = {
  level: "high" | "medium" | "low";
  explanation?: string;
};

export type ReportAction = {
  label: string;
  type:
    | "save_report"
    | "export_csv"
    | "copy_summary"
    | "open_drill_in"
    | "create_alert_disabled";
  payload?: unknown;
  disabled?: boolean;
  disabled_reason?: string;
};

export type ReportSchema = {
  type: "report";
  report_id?: string;
  report_type?: string;
  title: string;
  subtitle?: string;
  date_range?: { from: string; to: string };
  comparison_range?: { from: string; to: string };
  scope: ReportScope;
  status?: ReportStatus;
  summary_cards?: SummaryCard[];
  charts?: ChartSpec[];
  tables?: TableSpec[];
  recommendations?: Recommendation[];
  evidence?: Record<string, unknown> | EvidenceItem[];
  caveats?: string[];
  confidence?: ReportConfidence;
  actions?: ReportAction[];
};

export function isReportSchema(v: unknown): v is ReportSchema {
  return !!v && typeof v === "object" && (v as { type?: string }).type === "report";
}