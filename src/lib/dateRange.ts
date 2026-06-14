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
  | "thisWeek"
  | "last7"
  | "lastWeek"
  | "last14"
  | "thisMonth"
  | "last30"
  | "lastMonth"
  | "allTime";

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week (Sun – Today)",
  last7: "Last 7 days",
  lastWeek: "Last week (Sun – Sat)",
  last14: "Last 14 days",
  thisMonth: "This month",
  last30: "Last 30 days",
  lastMonth: "Last month",
  allTime: "All time",
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
    case "thisWeek": {
      const day = now.getDay(); // 0=Sun
      const from = startOfDay(addDays(now, -day));
      return { from, to: endOfDay(now), label: PRESET_LABELS.thisWeek };
    }
    case "last7":
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now), label: PRESET_LABELS.last7 };
    case "lastWeek": {
      const day = now.getDay();
      const lastSat = addDays(now, -day - 1);
      const lastSun = addDays(lastSat, -6);
      return { from: startOfDay(lastSun), to: endOfDay(lastSat), label: PRESET_LABELS.lastWeek };
    }
    case "last14":
      return { from: startOfDay(addDays(now, -13)), to: endOfDay(now), label: PRESET_LABELS.last14 };
    case "thisMonth":
      return { from: startOfDay(startOfMonth(now)), to: endOfDay(now), label: PRESET_LABELS.thisMonth };
    case "last30":
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now), label: PRESET_LABELS.last30 };
    case "lastMonth": {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return {
        from: startOfDay(startOfMonth(lm)),
        to: endOfDay(endOfMonth(lm)),
        label: PRESET_LABELS.lastMonth,
      };
    }
    case "allTime":
      return {
        from: startOfDay(new Date(2020, 0, 1)),
        to: endOfDay(now),
        label: PRESET_LABELS.allTime,
      };
  }
}

export function daysUpTo(n: number, upToYesterday = false): DateRange {
  const now = new Date();
  const end = upToYesterday ? addDays(now, -1) : now;
  const from = addDays(end, -(n - 1));
  return {
    from: startOfDay(from),
    to: endOfDay(end),
    label: `${n} days up to ${upToYesterday ? "yesterday" : "today"}`,
  };
}

export function priorPeriod(r: DateRange): DateRange {
  const fromDay = startOfDay(r.from);
  const toDay = startOfDay(r.to);
  const span = Math.max(0, Math.round((toDay.getTime() - fromDay.getTime()) / 86400000));
  const to = addDays(r.from, -1);
  const from = addDays(to, -span);
  return { from: startOfDay(from), to: endOfDay(to) };
}

/**
 * Same calendar slice in the previous month. For a "this month" range like
 * Jun 1–14, this returns May 1–14 (not the immediately-prior 14 days).
 * Clamps to the last day of the previous month when day-of-month doesn't exist.
 */
export function sameSliceLastMonth(r: DateRange): DateRange {
  const lastDayPrevMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
  const shift = (d: Date) => {
    const y = d.getFullYear();
    const m = d.getMonth(); // shift to m-1
    const day = Math.min(d.getDate(), lastDayPrevMonth(y, m));
    return new Date(y, m - 1, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  };
  return { from: startOfDay(shift(r.from)), to: endOfDay(shift(r.to)) };
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