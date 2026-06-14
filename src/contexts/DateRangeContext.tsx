import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { DateRange } from "@/lib/types";
import { getPresetRange, priorPeriod, PresetKey } from "@/lib/dateRange";

export type RangePreset = PresetKey | "custom";
export type CompareMode = "off" | "previous" | "custom";

interface DateRangeContextValue {
  range: DateRange;
  rangePreset: RangePreset;
  setRangePreset: (p: PresetKey) => void;
  setRange: (r: DateRange) => void;
  compareMode: CompareMode;
  setCompareMode: (m: CompareMode) => void;
  compareRange: DateRange;
  setCompareRange: (r: DateRange) => void;
}

const DateRangeContext = createContext<DateRangeContextValue | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRangeState] = useState<DateRange>(getPresetRange("last30"));
  const [rangePreset, setRangePresetState] = useState<RangePreset>("last30");
  const [compareMode, setCompareMode] = useState<CompareMode>("previous");
  const [compareRange, setCompareRange] = useState<DateRange>(priorPeriod(getPresetRange("last30")));

  const setRangePreset = (p: PresetKey) => {
    setRangePresetState(p);
    setRangeState(getPresetRange(p));
  };
  const setRange = (r: DateRange) => {
    setRangeState(r);
    setRangePresetState("custom");
  };

  useEffect(() => {
    if (compareMode === "previous") setCompareRange(priorPeriod(range));
  }, [range, compareMode]);

  return (
    <DateRangeContext.Provider
      value={{
        range, rangePreset, setRangePreset, setRange,
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