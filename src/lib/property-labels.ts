import { useScope } from "@/contexts/ScopeContext";

export const CUSTOMIZABLE_METRIC_KEYS = [
  "leads", "good_leads", "bad_leads", "projected_sale", "verified_sale", "spam",
] as const;

export type MetricKey = (typeof CUSTOMIZABLE_METRIC_KEYS)[number];

export const DEFAULT_METRIC_LABELS: Record<MetricKey, string> = {
  leads: "Total Leads",
  good_leads: "Good Leads",
  bad_leads: "Bad Leads",
  projected_sale: "Sales",
  verified_sale: "Verified Sale",
  spam: "Spam",
};

export interface PropertyMetricConfig {
  label: (key: MetricKey) => string;
  isHidden: (key: MetricKey) => boolean;
  labels: Partial<Record<MetricKey, string>>;
  hidden: Set<MetricKey>;
}

export function usePropertyMetricConfig(): PropertyMetricConfig {
  const { activeProperty } = useScope();
  const labels = (activeProperty?.metric_labels ?? {}) as Partial<Record<MetricKey, string>>;
  const hiddenArr = (activeProperty?.hidden_metrics ?? []) as MetricKey[];
  const hidden = new Set<MetricKey>(hiddenArr);
  return {
    labels,
    hidden,
    label: (k) => labels[k] || DEFAULT_METRIC_LABELS[k] || k,
    isHidden: (k) => hidden.has(k),
  };
}