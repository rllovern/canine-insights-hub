import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, GitCompare } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-background">
      <PublicTopBar />
      <main id="dashboard-canvas" className="flex-1 min-w-0 px-4 pt-4 pb-24 sm:px-6 sm:py-6 space-y-6 animate-fade-in">
        {children}
      </main>
      <footer className="border-t bg-card/50 py-4 px-6 text-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
          Powered by Ridgeside Canine
        </div>
      </footer>
    </div>
  );
}

function PublicTopBar() {
  const { activeProperty } = useAuth();
  const {
    range, setRange, rangePreset, setRangePreset,
    compareMode, setCompareMode, compareRange, setCompareRange,
  } = useDashboard();

  if (!activeProperty) return null;

  return (
    <header className="shrink-0 border-b bg-card/70 backdrop-blur-md sticky top-0 z-30 shadow-sm">
      <div className="px-4 py-3 md:h-[68px] md:px-6 md:py-0 flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
        <div className="flex items-center gap-3 min-w-0 md:flex-1">
          {/* Left: logo */}
          <div className="flex items-center shrink-0 min-w-0 md:w-44">
          {activeProperty.logo_url ? (
            <img
              src={activeProperty.logo_url}
              alt={`${activeProperty.name} logo`}
              className="h-10 md:h-11 w-auto max-w-full object-contain"
            />
          ) : (
            <div
              className="h-10 w-10 rounded-md grid place-items-center text-base font-bold text-white"
              style={{ background: activeProperty.brand_color || "hsl(var(--primary))" }}
            >
              {activeProperty.name.charAt(0)}
            </div>
          )}
          </div>

          {/* Center: title block */}
          <div className="min-w-0 flex-1 flex flex-col justify-center text-left md:items-center md:text-center leading-tight">
            <div className="text-[9px] md:text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
              Performance Report
            </div>
            <h1 className="text-sm md:text-base font-bold tracking-tight truncate max-w-full">
              {activeProperty.name}
            </h1>
          </div>
        </div>

        {/* Right: date controls */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap md:flex-nowrap md:justify-end">
          <div className="hidden 2xl:block text-[11px] text-muted-foreground tabular-nums mr-1">
            {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
            {compareMode !== "off" && (
              <span className="ml-2 text-primary/80">
                vs {format(compareRange.from, "MMM d")} – {format(compareRange.to, "MMM d, yyyy")}
              </span>
            )}
          </div>

          <Select value={rangePreset} onValueChange={(v) => setRangePreset(v as any)}>
            <SelectTrigger className="w-[8.75rem] md:w-36 h-9">
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
              <Button variant="outline" size="sm" className="h-9 w-9 px-0 md:w-auto md:px-3 gap-1.5 shrink-0">
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
                <Label htmlFor="cmp-toggle-pub" className="text-sm font-medium">Compare to range</Label>
                <Switch
                  id="cmp-toggle-pub"
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
        </div>
      </div>
    </header>
  );
}
