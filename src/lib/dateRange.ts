import { DateRange } from "./types";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const endOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

export type PresetKey =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth";

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  thisMonth: "This month",
  lastMonth: "Last month",
};

export function getPresetRange(key: PresetKey): DateRange {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now), label: PRESET_LABELS.today };
    case "yesterday": {
      const y = addDays(now, -1);
      return { from: startOfDay(y), to: endOfDay(y), label: PRESET_LABELS.yesterday };
    }
    case "last7":
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now), label: PRESET_LABELS.last7 };
    case "last30":
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now), label: PRESET_LABELS.last30 };
    case "thisMonth":
      return { from: startOfDay(startOfMonth(now)), to: endOfDay(now), label: PRESET_LABELS.thisMonth };
    case "lastMonth": {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: startOfDay(startOfMonth(lm)),
        to: endOfDay(endOfMonth(lm)),
        label: PRESET_LABELS.lastMonth,
      };
    }
  }
}

export function formatRangeLabel(range: DateRange): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (
    range.from.toDateString() === range.to.toDateString()
  ) {
    return fmt(range.from);
  }
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}