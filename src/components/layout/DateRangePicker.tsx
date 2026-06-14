import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { addMonths, format, isAfter, isBefore, startOfMonth } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDateRange } from "@/contexts/DateRangeContext";
import {
  PRESET_LABELS,
  PresetKey,
  daysUpTo,
  getPresetRange,
  priorPeriod,
} from "@/lib/dateRange";
import type { DateRange as AppDateRange } from "@/lib/types";

const PRESETS: PresetKey[] = [
  "today",
  "yesterday",
  "thisWeek",
  "last7",
  "lastWeek",
  "last14",
  "thisMonth",
  "last30",
  "lastMonth",
  "allTime",
];

const fmtShort = (d: Date) => format(d, "M/d/yyyy");
const fmtLong = (d: Date) => format(d, "MMM d, yyyy");

function parseInput(v: string): Date | null {
  const [year, month, day] = v.split("-").map(Number);
  const d = year && month && day ? new Date(year, month - 1, day) : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function DateRangePicker() {
  const {
    range, rangePreset, applySelection,
    compareMode, compareRange,
  } = useDateRange();

  const [open, setOpen] = useState(false);

  // Local draft state (mirrors live until Apply is clicked).
  const [draftRange, setDraftRange] = useState<AppDateRange>(range);
  const [draftPreset, setDraftPreset] = useState<PresetKey | "custom">(rangePreset);
  const [draftCompareMode, setDraftCompareMode] = useState(compareMode);
  const [draftCompareRange, setDraftCompareRange] = useState<AppDateRange>(compareRange);
  const [upToToday, setUpToToday] = useState<number>(30);
  const [upToYesterday, setUpToYesterday] = useState<number>(30);
  const [activeRange, setActiveRange] = useState<"current" | "compare">("current");
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [visibleMonth, setVisibleMonth] = useState<Date>(startOfMonth(addMonths(range.to, -1)));

  const calendarModifiers = useMemo(() => ({
    current_range: draftRange,
    current_start: draftRange.from,
    current_end: draftRange.to,
    ...(draftCompareMode !== "off" ? {
      compare_range: draftCompareRange,
      compare_start: draftCompareRange.from,
      compare_end: draftCompareRange.to,
    } : {}),
  }), [draftRange, draftCompareMode, draftCompareRange]);

  // Reset draft when opening.
  useEffect(() => {
    if (open) {
      setDraftRange(range);
      setDraftPreset(rangePreset);
      setDraftCompareMode(compareMode);
      setDraftCompareRange(compareRange);
      setActiveRange("current");
      setPendingStart(null);
      setVisibleMonth(startOfMonth(addMonths(range.to, -1)));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep compare auto-tracking when "previous" selected and not custom-edited.
  useEffect(() => {
    if (draftCompareMode === "previous") {
      setDraftCompareRange(priorPeriod(draftRange));
    }
  }, [draftRange, draftCompareMode]);

  const triggerLabel = useMemo(() => {
    const base = rangePreset === "custom"
      ? `${fmtShort(range.from)} – ${fmtShort(range.to)}`
      : PRESET_LABELS[rangePreset];
    return base;
  }, [range, rangePreset]);

  function pickPreset(p: PresetKey) {
    const next = getPresetRange(p);
    setDraftPreset(p);
    setDraftRange(next);
    setActiveRange("current");
    setPendingStart(null);
    setVisibleMonth(startOfMonth(addMonths(next.to, -1)));
  }

  function applyDaysUpTo(n: number, yesterday: boolean) {
    if (!n || n < 1) return;
    const next = daysUpTo(n, yesterday);
    setDraftPreset("custom");
    setDraftRange(next);
    setActiveRange("current");
    setPendingStart(null);
    setVisibleMonth(startOfMonth(addMonths(next.to, -1)));
  }

  function setPrimaryRange(next: AppDateRange, preset: PresetKey | "custom" = "custom") {
    setDraftPreset(preset);
    setDraftRange(next);
    setActiveRange("current");
    setPendingStart(null);
  }

  function setComparisonRange(next: AppDateRange) {
    setDraftCompareMode("custom");
    setDraftCompareRange(next);
    setActiveRange("compare");
    setPendingStart(null);
  }

  function handleDayClick(day: Date) {
    if (isAfter(day, new Date())) return;
    const setter = activeRange === "compare" && draftCompareMode !== "off"
      ? (next: AppDateRange) => setComparisonRange(next)
      : (next: AppDateRange) => setPrimaryRange(next);

    if (!pendingStart) {
      setter({ from: day, to: day });
      setPendingStart(day);
      return;
    }

    const from = isBefore(day, pendingStart) ? day : pendingStart;
    const to = isBefore(day, pendingStart) ? pendingStart : day;
    setter({ from, to });
    setPendingStart(null);
  }

  function apply() {
    applySelection({
      range: draftRange,
      preset: draftPreset,
      compareMode: draftCompareMode,
      compareRange: draftCompareRange,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 bg-card font-medium shadow-sm">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs tabular-nums">{triggerLabel}</span>
          {compareMode !== "off" && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                vs {fmtShort(compareRange.from)} – {fmtShort(compareRange.to)}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-auto p-0 z-50 bg-popover"
      >
        <div className="flex">
          {/* Left: presets */}
          <div className="flex w-56 flex-col border-r border-border">
            <div className="flex-1 overflow-auto p-1.5">
              <button
                onClick={() => setDraftPreset("custom")}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted",
                  draftPreset === "custom" && "bg-primary/10 text-primary",
                )}
              >
                Custom
              </button>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => pickPreset(p)}
                  className={cn(
                    "w-full rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted",
                    draftPreset === p && "bg-primary/10 text-primary",
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            <Separator />
            <div className="space-y-2 p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={upToToday}
                  onChange={(e) => setUpToToday(Number(e.target.value))}
                  onBlur={() => applyDaysUpTo(upToToday, false)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyDaysUpTo(upToToday, false); }}
                  className="h-7 w-14 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">days up to today</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={upToYesterday}
                  onChange={(e) => setUpToYesterday(Number(e.target.value))}
                  onBlur={() => applyDaysUpTo(upToYesterday, true)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyDaysUpTo(upToYesterday, true); }}
                  className="h-7 w-14 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">days up to yesterday</span>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 p-2.5">
              <Label htmlFor="cmp" className="text-xs font-medium">Compare</Label>
              <Switch
                id="cmp"
                checked={draftCompareMode !== "off"}
                onCheckedChange={(on) => {
                  setDraftCompareMode(on ? "previous" : "off");
                  setDraftCompareRange(priorPeriod(draftRange));
                  setActiveRange(on ? "compare" : "current");
                  setPendingStart(null);
                }}
              />
            </div>
            {draftCompareMode !== "off" && (
              <div className="px-2.5 pb-2.5">
                <Select value={draftCompareMode} onValueChange={(v) => {
                  const mode = v as "previous" | "custom";
                  setDraftCompareMode(mode);
                  if (mode === "previous") setDraftCompareRange(priorPeriod(draftRange));
                  setActiveRange(mode === "custom" ? "compare" : "current");
                  setPendingStart(null);
                }}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-50 bg-popover">
                    <SelectItem value="previous">Previous period</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Right: date inputs + calendar */}
          <div className="flex w-[560px] flex-col p-3">
            <div className="grid grid-cols-2 gap-3">
              <DateField
                label="Start date"
                value={draftRange.from}
                onFocus={() => { setActiveRange("current"); setPendingStart(null); }}
                onChange={(d) => setPrimaryRange({ ...draftRange, from: d })}
              />
              <DateField
                label="End date"
                value={draftRange.to}
                onFocus={() => { setActiveRange("current"); setPendingStart(null); }}
                onChange={(d) => setPrimaryRange({ ...draftRange, to: d })}
              />
            </div>

            {draftCompareMode !== "off" && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Compare</div>
                  <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                    <Button
                      type="button"
                      variant={activeRange === "current" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => { setActiveRange("current"); setPendingStart(null); }}
                    >
                      Date range
                    </Button>
                    <Button
                      type="button"
                      variant={activeRange === "compare" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => { setDraftCompareMode("custom"); setActiveRange("compare"); setPendingStart(null); }}
                    >
                      Compare range
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DateField
                    label="Start date"
                    value={draftCompareRange.from}
                    onFocus={() => { setActiveRange("compare"); setPendingStart(null); }}
                    onChange={(d) => setComparisonRange({ ...draftCompareRange, from: d })}
                  />
                  <DateField
                    label="End date"
                    value={draftCompareRange.to}
                    onFocus={() => { setActiveRange("compare"); setPendingStart(null); }}
                    onChange={(d) => setComparisonRange({ ...draftCompareRange, to: d })}
                  />
                </div>
              </div>
            )}

            <div className="mt-3 -mx-1">
              <Calendar
                month={visibleMonth}
                onMonthChange={setVisibleMonth}
                disabled={{ after: new Date() }}
                onDayClick={handleDayClick}
                modifiers={calendarModifiers}
                modifiersClassNames={{
                  current_range: "bg-primary/15 text-foreground hover:bg-primary/20",
                  current_start: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  current_end: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                  compare_range: "bg-destructive/15 text-foreground hover:bg-destructive/20",
                  compare_start: "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground focus:bg-destructive focus:text-destructive-foreground",
                  compare_end: "bg-destructive text-destructive-foreground hover:bg-destructive hover:text-destructive-foreground focus:bg-destructive focus:text-destructive-foreground",
                }}
                numberOfMonths={2}
                className="p-0 pointer-events-auto"
              />
            </div>

            <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={apply}>Apply</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateField({ label, value, onChange, onFocus }: { label: string; value: Date; onChange: (d: Date) => void; onFocus?: () => void }) {
  const [text, setText] = useState(format(value, "yyyy-MM-dd"));
  useEffect(() => { setText(format(value, "yyyy-MM-dd")); }, [value]);
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="date"
        value={text}
        onFocus={onFocus}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const d = parseInput(text); if (d) onChange(d); }}
        className="h-8 text-xs mt-0.5"
      />
    </div>
  );
}