import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useDateRange } from "@/contexts/DateRangeContext";
import { formatRangeLabel, getPresetRange, PRESET_LABELS, PresetKey } from "@/lib/dateRange";

const PRESETS: PresetKey[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"];

export function DateRangePicker() {
  const { range, setRange } = useDateRange();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 gap-2 bg-card text-xs font-medium",
            "shadow-sm",
          )}
        >
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{range.label}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{formatRangeLabel(range)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <div className="flex">
          <div className="flex w-40 flex-col gap-0.5 border-r border-border p-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setRange(getPresetRange(p));
                  setOpen(false);
                }}
                className={cn(
                  "rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted",
                  range.label === PRESET_LABELS[p] && "bg-primary-muted text-primary",
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}
            <Separator className="my-1" />
            <span className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Custom
            </span>
          </div>
          <Calendar
            mode="range"
            selected={{ from: range.from, to: range.to }}
            onSelect={(r) => {
              if (r?.from && r?.to) {
                setRange({ from: r.from, to: r.to, label: "Custom" });
              }
            }}
            numberOfMonths={2}
            className={cn("p-3 pointer-events-auto")}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}