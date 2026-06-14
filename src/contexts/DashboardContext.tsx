import { createContext, useContext, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBlendedMetrics, type MetricRow } from "@/lib/data-sources";
import { rangeToISO, type DateRange } from "@/lib/metrics";
import { useProperties } from "./PropertyContext";
import { useScope } from "./ScopeContext";
import { useDateRange, type CompareMode, type RangePreset } from "./DateRangeContext";
import type { PresetKey } from "@/lib/dateRange";

export type { CompareMode, RangePreset };

export interface DashboardCtx {
  range: DateRange;
  setRange: (r: DateRange) => void;
  rangePreset: RangePreset;
  setRangePreset: (p: PresetKey) => void;
  compareMode: CompareMode;
  setCompareMode: (m: CompareMode) => void;
  compareRange: DateRange;
  setCompareRange: (r: DateRange) => void;
  current: MetricRow[];
  prior: MetricRow[];
  isLoading: boolean;
}

const Ctx = createContext<DashboardCtx>({} as DashboardCtx);

interface ProviderProps {
  children: ReactNode;
  fetcher?: (from: string, to: string) => Promise<MetricRow[]>;
  fetcherKey?: string;
  enabled?: boolean;
}

export function DashboardProvider({ children, fetcher, fetcherKey, enabled }: ProviderProps) {
  const { properties } = useProperties();
  const { activeProperty: scopeProperty, mode, propertyIds } = useScope();
  const activeProperty = scopeProperty ?? (mode === "agency" ? (properties[0] ?? null) : null);
  const {
    range, setRange, rangePreset, setRangePreset,
    compareMode, setCompareMode, compareRange, setCompareRange,
  } = useDateRange();

  const iso = rangeToISO(range);
  const effCmp = compareMode === "off" ? null : compareRange;
  const cmpIso = effCmp ? rangeToISO(effCmp) : null;

  const queryFn = fetcher ?? ((from: string, to: string) => fetchBlendedMetrics(mode === "agency" ? null : activeProperty?.id ?? null, from, to, propertyIds));
  const queryKey = fetcherKey ?? (mode === "agency" ? `agency:${propertyIds?.join(",") ?? "all"}` : activeProperty?.id);
  const queryEnabled = enabled ?? (mode === "agency" || !!activeProperty);

  const currentQ = useQuery({
    queryKey: ["metrics", queryKey, iso.from, iso.to],
    queryFn: () => queryFn(iso.from, iso.to),
    enabled: queryEnabled,
  });
  const priorQ = useQuery({
    queryKey: ["metrics", queryKey, cmpIso?.from, cmpIso?.to],
    queryFn: () => queryFn(cmpIso!.from, cmpIso!.to),
    enabled: queryEnabled && !!cmpIso,
  });

  const value = useMemo<DashboardCtx>(() => ({
    range, setRange, rangePreset, setRangePreset,
    compareMode, setCompareMode, compareRange, setCompareRange,
    current: currentQ.data ?? [],
    prior: compareMode === "off" ? [] : (priorQ.data ?? []),
    isLoading: currentQ.isLoading || (compareMode !== "off" && priorQ.isLoading),
  }), [range, rangePreset, compareMode, compareRange, currentQ.data, priorQ.data, currentQ.isLoading, priorQ.isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useDashboard = () => useContext(Ctx);