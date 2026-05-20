import { useState } from "react";
import { Calendar as CalendarIcon, GitCompare } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useDashboard } from "@/contexts/DashboardContext";

export function PublicReportToolbar({ leading }: { leading?: React.ReactNode } = {}) {
  const {
    range, setRange, rangePreset, setRangePreset,
    compareMode, setCompareMode, compareRange, setCompareRange,
  } = useDashboard();
  const [openRange, setOpenRange] = useState(false);

  return (
    <div className="flex items-center gap-2">
      {leading}
      <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as any)}>
        <SelectTrigger className="h-9 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mtd">This Month</SelectItem>
          <SelectItem value="7">Last 7 days</SelectItem>
          <SelectItem value="30">Last 30 days</SelectItem>
          <SelectItem value="90">Last 90 days</SelectItem>
          {rangePreset === "custom" && <SelectItem value="custom">Custom</SelectItem>}
        </SelectContent>
      </Select>

      <Popover open={openRange} onOpenChange={setOpenRange}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-1.5">
            <CalendarIcon className="size-4" />
            <span className="text-xs tabular-nums">
              {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0 z-50 bg-popover" sideOffset={6}>
          <Calendar
            mode="range"
            defaultMonth={range.from}
            selected={{ from: range.from, to: range.to }}
            onSelect={(r) => {
              if (r?.from && r?.to) {
                setRange({ from: r.from, to: r.to });
                setOpenRange(false);
              }
            }}
            numberOfMonths={2}
            className="p-3 pointer-events-auto"
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={compareMode !== "off" ? "default" : "outline"}
            size="sm"
            className={cn("h-9 gap-1.5")}
          >
            <GitCompare className="size-4" />
            <span className="text-xs">
              {compareMode === "off" ? "Compare" : compareMode === "previous" ? "vs previous" : "vs custom"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-4 z-50 bg-popover space-y-4" sideOffset={6}>
          <div className="flex items-center justify-between">
            <Label htmlFor="pub-cmp-toggle" className="text-sm font-medium">Compare to range</Label>
            <Switch
              id="pub-cmp-toggle"
              checked={compareMode !== "off"}
              onCheckedChange={(on) => setCompareMode(on ? "previous" : "off")}
            />
          </div>
          {compareMode !== "off" && (
            <>
              <Select value={compareMode} onValueChange={(v) => setCompareMode(v as any)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="z-50 bg-popover">
                  <SelectItem value="previous">Previous period (auto)</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              <Separator />
              <div className="text-xs text-muted-foreground">
                Comparing against{" "}
                <span className="font-medium text-foreground">
                  {format(compareRange.from, "MMM d, yyyy")} – {format(compareRange.to, "MMM d, yyyy")}
                </span>
              </div>
              {compareMode === "custom" && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <Calendar
                    mode="range"
                    defaultMonth={compareRange.from}
                    selected={{ from: compareRange.from, to: compareRange.to }}
                    onSelect={(r) => { if (r?.from && r?.to) setCompareRange({ from: r.from, to: r.to }); }}
                    className="p-3 pointer-events-auto"
                    numberOfMonths={1}
                  />
                </div>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
