/**
 * Per-client terminology + visibility configuration.
 *
 * Each client can:
 *   1. Override the display label for any metric (e.g. "Admissions" → "Sales").
 *   2. Hide metrics that don't apply (e.g. hide "Medicaid" for non-medical clients).
 *
 * Underlying data columns/keys never change — only how they are labeled
 * and whether their UI cards/columns/rows are rendered.
 */

import { useAuth } from "@/contexts/AuthContext";

/** Metric keys that are user-facing and customizable. Tied to `daily_metrics` columns. */
export const CUSTOMIZABLE_METRIC_KEYS = [
  "leads",
  "good_leads",
  "bad_leads",
  "admissions",
  "medicaid",
  "spam",
] as const;

export type MetricKey = (typeof CUSTOMIZABLE_METRIC_KEYS)[number];

/** Default user-facing label for each metric key. */
export const DEFAULT_METRIC_LABELS: Record<MetricKey, string> = {
  leads: "Leads",
  good_leads: "Good Leads",
  bad_leads: "Bad Leads",
  admissions: "Admissions",
  medicaid: "Medicaid",
  spam: "Spam",
};

export interface ClientMetricConfig {
  /** Get the label for a metric key, falling back to default. */
  label: (key: MetricKey) => string;
  /** Returns true if the metric should be hidden for this client. */
  isHidden: (key: MetricKey) => boolean;
  /** Raw overrides as stored on the client row. */
  labels: Partial<Record<MetricKey, string>>;
  hidden: Set<MetricKey>;
}

/**
 * React hook returning the active client's metric label/visibility config.
 * Falls back to defaults when no active client or no overrides are set.
 */
export function useClientMetricConfig(): ClientMetricConfig {
  const { activeProperty } = useAuth();
  const labels = (activeProperty?.metric_labels ?? {}) as Partial<Record<MetricKey, string>>;
  const hiddenArr = (activeProperty?.hidden_metrics ?? []) as MetricKey[];
  const hidden = new Set<MetricKey>(hiddenArr);

  return {
    labels,
    hidden,
    label: (key) => labels[key] || DEFAULT_METRIC_LABELS[key] || key,
    isHidden: (key) => hidden.has(key),
  };
}
