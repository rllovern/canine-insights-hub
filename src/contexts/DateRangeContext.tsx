import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { DateRange } from "@/lib/types";
import { getPresetRange, priorPeriod, PresetKey } from "@/lib/dateRange";

export type RangePreset = PresetKey | "custom";
export type CompareMode = "off" | "previous" | "custom";

/**
 * Compare range for "previous" mode. Always the immediately preceding period
 * of equal length — e.g. Jul 1–7 → Jun 24–30.
 */
function defaultCompareFor(range: DateRange, _preset: RangePreset): DateRange {
  return priorPeriod(range);
}

interface DateRangeContextValue {
  range: DateRange;
  rangePreset: RangePreset;
  setRangePreset: (p: PresetKey) => void;
  setRange: (r: DateRange) => void;
  applySelection: (next: { range: DateRange; preset: RangePreset; compareMode: CompareMode; compareRange: DateRange }) => void;
  compareMode: CompareMode;
  setCompareMode: (m: CompareMode) => void;
  compareRange: DateRange;
  setCompareRange: (r: DateRange) => void;
}

const DateRangeContext = createContext<DateRangeContextValue | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(getPresetRange("thisMonth"));
  const [rangePreset, setRangePresetState] = useState<RangePreset>("thisMonth");
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [compareRange, setCompareRange] = useState<DateRange>(
    defaultCompareFor(getPresetRange("thisMonth"), "thisMonth"),
  );

  const setRangePreset = (p: PresetKey) => {
    setRangePresetState(p);
    setRangeState(getPresetRange(p));
  };
  const setRange = (r: DateRange) => {
    setRangeState(r);
    setRangePresetState("custom");
  };
  const applySelection = (next: { range: DateRange; preset: RangePreset; compareMode: CompareMode; compareRange: DateRange }) => {
    setRangePresetState(next.preset);
    setRangeState(next.range);
    setCompareMode(next.compareMode);
    setCompareRange(next.compareMode === "previous" ? defaultCompareFor(next.range, next.preset) : next.compareRange);
  };

  useEffect(() => {
    if (compareMode === "previous") setCompareRange(defaultCompareFor(range, rangePreset));
  }, [range, compareMode, rangePreset]);

  return (
    <DateRangeContext.Provider
      value={{
        range, rangePreset, setRangePreset, setRange, applySelection,
        compareMode, setCompareMode, compareRange, setCompareRange,
      }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}