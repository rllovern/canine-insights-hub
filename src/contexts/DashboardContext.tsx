import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBlendedMetrics, type MetricRow } from "@/lib/data-sources";
import { getRange, priorRange, rangeToISO, type DateRange } from "@/lib/metrics";
import { useProperties } from "./PropertyContext";
import { useScope } from "./ScopeContext";
import { startOfMonth } from "date-fns";

export type CompareMode = "off" | "previous" | "custom";
export type RangePreset = "mtd" | "7" | "30" | "90" | "custom";

function presetToRange(preset: RangePreset): DateRange {
  if (preset === "mtd") {
    const now = new Date();
    return { from: startOfMonth(now), to: now };
  }
  const days = preset === "custom" ? 30 : Number(preset);
  return getRange(days);
}

export interface DashboardCtx {
  range: DateRange;
  setRange: (r: DateRange) => void;
  rangePreset: RangePreset;
  setRangePreset: (p: RangePreset) => void;
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
  const { activeProperty: scopeProperty, mode } = useScope();
  // Dashboard (PPC Overview) is single-property today. In agency mode, fall
  // back to the first available property so the page still renders; Command
  // is the proper agency landing page.
  const activeProperty = scopeProperty ?? (mode === "agency" ? (properties[0] ?? null) : null);
  const [rangePreset, setRangePresetState] = useState<RangePreset>("mtd");
  const [range, setRangeState] = useState<DateRange>(presetToRange("mtd"));
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [compareRange, setCompareRange] = useState<DateRange>(priorRange(presetToRange("mtd")));

  const setRangePreset = (p: RangePreset) => {
    setRangePresetState(p);
    if (p !== "custom") setRangeState(presetToRange(p));
  };
  const setRange = (r: DateRange) => {
    setRangeState(r);
    setRangePresetState("custom");
  };

  useEffect(() => {
    if (compareMode === "previous") setCompareRange(priorRange(range));
  }, [range, compareMode]);

  const iso = rangeToISO(range);
  const effCmp = compareMode === "off" ? null : compareRange;
  const cmpIso = effCmp ? rangeToISO(effCmp) : null;

  const queryFn = fetcher ?? ((from: string, to: string) => fetchBlendedMetrics(activeProperty!.id, from, to));
  const queryKey = fetcherKey ?? activeProperty?.id;
  const queryEnabled = enabled ?? !!activeProperty;

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