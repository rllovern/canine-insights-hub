import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { useScope } from "@/contexts/ScopeContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Globe2, Building2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "./DateRangePicker";

export function TopBar() {
  const { mode, label } = useScope();
  const { isSuperAdmin, isLocationOwner, previewingLocationOwner, togglePreviewLocationOwner } = usePreviewMode();
  const { range, compareMode, compareRange } = useDashboard();

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

        <DateRangePicker />

        {isSuperAdmin && (
          <div className="flex items-center gap-2 h-9 px-2 sm:px-3 rounded-md border border-amber-300 bg-amber-50">
            <UserCog className="size-3.5 text-amber-700" />
            <Label htmlFor="view-as-location-owner-toggle" className="hidden sm:inline text-xs font-medium cursor-pointer select-none text-amber-900">
              {previewingLocationOwner ? "Viewing as Location Owner" : "View as Location Owner"}
            </Label>
            <Switch id="view-as-location-owner-toggle" checked={previewingLocationOwner} onCheckedChange={togglePreviewLocationOwner} />
          </div>
        )}

        {isLocationOwner && (
          <Badge variant="secondary" className="gap-1.5 h-9 px-2 sm:px-3 rounded-md">
            <Eye className="size-3.5" /> <span className="hidden sm:inline">Client View</span>
          </Badge>
        )}
      </div>
    </header>
  );
}