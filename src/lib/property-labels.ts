import { useProperties } from "@/contexts/PropertyContext";

export const CUSTOMIZABLE_METRIC_KEYS = [
  "leads", "good_leads", "bad_leads", "admissions", "medicaid", "spam",
] as const;

export type MetricKey = (typeof CUSTOMIZABLE_METRIC_KEYS)[number];

export const DEFAULT_METRIC_LABELS: Record<MetricKey, string> = {
  leads: "Leads",
  good_leads: "Good Leads",
  bad_leads: "Bad Leads",
  admissions: "Sale",
  medicaid: "Medicaid",
  spam: "Spam",
};

export interface PropertyMetricConfig {
  label: (key: MetricKey) => string;
  isHidden: (key: MetricKey) => boolean;
  labels: Partial<Record<MetricKey, string>>;
  hidden: Set<MetricKey>;
}

export function usePropertyMetricConfig(): PropertyMetricConfig {
  const { activeProperty } = useProperties();
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