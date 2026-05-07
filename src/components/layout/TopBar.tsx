import { useAuth } from "@/contexts/AuthContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarIcon, Download, ShieldCheck, Eye, Plus, GitCompare } from "lucide-react";
import { Link } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { exportCurrentViewCSV, exportCurrentViewPDF } from "@/lib/export";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SyncHealthBell } from "@/components/admin/SyncHealthBell";

export function TopBar({ title }: { title: string }) {
  const { role, effectiveRole, viewAsViewer, setViewAsViewer, clients, activeProperty, setActiveProperty } = useAuth();
  const {
    range, setRange, rangePreset, setRangePreset, current,
    compareMode, setCompareMode, compareRange, setCompareRange,
  } = useDashboard();

  return (
    <header className="shrink-0 border-b bg-card/70 backdrop-blur-md sticky top-0 z-30">
      <div className="min-h-16 px-4 py-3 sm:px-6 sm:py-0 flex flex-wrap items-center gap-2 sm:gap-4">
        {/* Page title */}
        <div className="basis-full sm:basis-auto flex-1 min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight truncate">{title}</h1>
          <div className="text-xs text-muted-foreground leading-relaxed sm:truncate whitespace-normal break-words">
            {activeProperty?.name ?? "—"} · {format(range.from, "MMM d")} – {format(range.to, "MMM d, yyyy")}
            {compareMode !== "off" && (
              <span className="block sm:inline sm:ml-2 text-primary/80">
                vs {format(compareRange.from, "MMM d")} – {format(compareRange.to, "MMM d, yyyy")}
              </span>
            )}
          </div>
        </div>

        {/* Property switcher (internal only) */}
        {role === "internal" && clients.length > 0 && (
          <Select value={activeProperty?.id} onValueChange={(v) => setActiveProperty(clients.find((c) => c.id === v) ?? null)}>
            <SelectTrigger className="w-[11rem] sm:w-48 h-9">
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {role === "internal" && clients.length === 0 && (
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
            <Link to="/admin/properties">
              <Plus className="size-4" /> Add your first client
            </Link>
          </Button>
        )}

        {/* Property logo (center-ish) */}
        {activeProperty && (
          <div className="hidden lg:flex items-center gap-2 px-3 h-9 rounded-md border bg-card">
            <div className="size-5 rounded grid place-items-center text-[10px] font-bold text-white"
                 style={{ background: activeProperty.brand_color || "hsl(var(--primary))" }}>
              {activeProperty.name.charAt(0)}
            </div>
            <span className="text-xs font-medium">{activeProperty.name}</span>
          </div>
        )}

        {/* Date preset */}
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

        {/* Custom range */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 w-9 px-0 xl:h-9 xl:w-auto xl:px-3 gap-1.5 shrink-0">
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

        {/* Compare to */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={compareMode !== "off" ? "default" : "outline"}
              size="sm"
              className="h-9 w-9 px-0 md:h-9 md:w-auto md:px-3 gap-1.5 shrink-0"
            >
              <GitCompare className="size-4" />
              <span className="hidden md:inline text-xs">
                {compareMode === "off" ? "Compare" :
                  compareMode === "previous" ? "vs previous" : "vs custom"}
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

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9">
              <Download className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportCurrentViewCSV(current, activeProperty?.slug)}>Export CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportCurrentViewPDF(activeProperty?.slug)}>Export PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sync health (internal only) */}
        {role === "internal" && <SyncHealthBell />}

        {/* View-as toggle (internal only) */}
        {role === "internal" ? (
          <div className="flex items-center gap-2 h-9 px-2 sm:px-3 rounded-md border bg-card">
            {effectiveRole === "internal" ? (
              <ShieldCheck className="size-3.5 text-primary" />
            ) : (
              <Eye className="size-3.5 text-muted-foreground" />
            )}
            <Label htmlFor="view-as-toggle" className="hidden sm:inline text-xs font-medium cursor-pointer select-none">
              {effectiveRole === "internal" ? "Internal View" : "Property View"}
            </Label>
            <Switch
              id="view-as-toggle"
              checked={viewAsViewer}
              onCheckedChange={setViewAsViewer}
              aria-label="Toggle client view"
            />
          </div>
        ) : (
          <Badge variant="secondary" className="gap-1.5 h-9 px-2 sm:px-3 rounded-md">
            <Eye className="size-3.5" /> <span className="hidden sm:inline">Property View</span>
          </Badge>
        )}
      </div>
    </header>
  );
}
