import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { useScope } from "@/contexts/ScopeContext";
import { Badge } from "@/components/ui/badge";
import { Eye, Globe2, Building2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { DateRangePicker } from "./DateRangePicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppRole } from "@/lib/types";

const PREVIEW_ROLE_LABELS: Record<Exclude<AppRole, "internal" | "viewer">, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  owner: "Owner",
  location_owner: "Location Owner",
};

export function TopBar() {
  const { mode, label } = useScope();
  const { realRole, previewRole, setPreviewRole, isPreviewing, isLocationOwner } = usePreviewMode();
  const { range, compareMode, compareRange } = useDashboard();
  const realIsSuperAdmin = realRole === "super_admin";

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

        {realIsSuperAdmin && (
          <div className={`flex items-center gap-2 h-9 px-2 sm:px-3 rounded-md border ${isPreviewing ? "border-amber-300 bg-amber-50" : "border-border bg-card"}`}>
            <UserCog className={`size-3.5 ${isPreviewing ? "text-amber-700" : "text-muted-foreground"}`} />
            <span className={`hidden sm:inline text-xs font-medium ${isPreviewing ? "text-amber-900" : "text-muted-foreground"}`}>
              Viewing as
            </span>
            <Select
              value={(previewRole ?? "super_admin") as string}
              onValueChange={(v) => setPreviewRole(v as AppRole)}
            >
              <SelectTrigger className="h-7 w-[150px] border-0 bg-transparent px-2 text-xs font-semibold focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="super_admin">{PREVIEW_ROLE_LABELS.super_admin}</SelectItem>
                <SelectItem value="admin">{PREVIEW_ROLE_LABELS.admin}</SelectItem>
                <SelectItem value="owner">{PREVIEW_ROLE_LABELS.owner}</SelectItem>
                <SelectItem value="location_owner">{PREVIEW_ROLE_LABELS.location_owner}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {!realIsSuperAdmin && isLocationOwner && (
          <Badge variant="secondary" className="gap-1.5 h-9 px-2 sm:px-3 rounded-md">
            <Eye className="size-3.5" /> <span className="hidden sm:inline">Client View</span>
          </Badge>
        )}
      </div>
    </header>
  );
}