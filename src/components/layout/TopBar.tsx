import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { useScope } from "@/contexts/ScopeContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, ShieldCheck, Eye, GitCompare, Globe2, Building2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export function TopBar() {
  const { mode, label, activeProperty } = useScope();
  const { realRole, effectiveRole, isPreviewing, togglePreview } = usePreviewMode();
  const {
    range, setRange, rangePreset, setRangePreset,
    compareMode, setCompareMode, compareRange, setCompareRange,
  } = useDashboard();

  return (
    <header className="shrink-0 border-b border-border bg-card sticky top-0 z-30">
      <div className="min-h-16 px-4 py-3 sm:px-6 sm:py-0 flex flex-wrap items-center gap-2 sm:gap-4">
        <div className="basis-full sm:basis-auto flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold tracking-tight truncate text-foreground flex items-center gap-2">
            {mode === "agency" ? <Globe2 className="size-4 text-primary" /> : <Building2 className="size-4 text-primary" />}
            {label}
          </h1>
          <div className="mt-1 h-[2px] w-10 rounded-full bg-gold" />
          <div className="text-xs text-muted-foreground leading-relaxed sm:truncate">
            {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
            {compareMode !== "off" && (
              <span className="ml-2 text-accent">
                vs {format(compareRange.from, "MMM d")} – {format(compareRange.to, "MMM d, yyyy")}
              </span>
            )}
          </div>
        </div>

        {/* Scope is now driven from the left rail. */}

        <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as any)}>
          <SelectTrigger className="w-[8.75rem] sm:w-36 h-9">
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

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 w-9 px-0 xl:w-auto xl:px-3 gap-1.5 shrink-0">
              <CalendarIcon className="size-4" />
              <span className="hidden xl:inline text-xs tabular-nums">
                {format(range.from, "MMM d")} – {format(range.to, "MMM d")}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0 z-50 bg-popover" sideOffset={6}>
            <Calendar
              mode="range"
              defaultMonth={range.from}
              selected={{ from: range.from, to: range.to }}
              onSelect={(r) => { if (r?.from && r?.to) setRange({ from: r.from, to: r.to }); }}
              className="p-3 pointer-events-auto"
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={compareMode !== "off" ? "default" : "outline"}
              size="sm"
              className="h-9 w-9 px-0 md:w-auto md:px-3 gap-1.5 shrink-0"
            >
              <GitCompare className="size-4" />
              <span className="hidden md:inline text-xs">
                {compareMode === "off" ? "Compare" : compareMode === "previous" ? "vs previous" : "vs custom"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-4 z-50 bg-popover space-y-4" sideOffset={6}>
            <div className="flex items-center justify-between">
              <Label htmlFor="cmp-toggle" className="text-sm font-medium">Compare to range</Label>
              <Switch
                id="cmp-toggle"
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

        {realRole === "internal" ? (
          <div className="flex items-center gap-2 h-9 px-2 sm:px-3 rounded-md border bg-card">
            {effectiveRole === "internal" ? (
              <ShieldCheck className="size-3.5 text-primary" />
            ) : (
              <Eye className="size-3.5 text-muted-foreground" />
            )}
            <Label htmlFor="view-as-toggle" className="hidden sm:inline text-xs font-medium cursor-pointer select-none">
              {effectiveRole === "internal" ? "Internal View" : "Client View"}
            </Label>
            <Switch id="view-as-toggle" checked={isPreviewing} onCheckedChange={togglePreview} />
          </div>
        ) : (
          <Badge variant="secondary" className="gap-1.5 h-9 px-2 sm:px-3 rounded-md">
            <Eye className="size-3.5" /> <span className="hidden sm:inline">Client View</span>
          </Badge>
        )}
      </div>
    </header>
  );
}