import { createContext, useContext, useState, ReactNode } from "react";
import { DateRange } from "@/lib/types";
import { getPresetRange } from "@/lib/dateRange";

interface DateRangeContextValue {
  range: DateRange;
  setRange: (r: DateRange) => void;
}

const DateRangeContext = createContext<DateRangeContextValue | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<DateRange>(getPresetRange("last30"));
  return (
    <DateRangeContext.Provider value={{ range, setRange }}>{children}</DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}