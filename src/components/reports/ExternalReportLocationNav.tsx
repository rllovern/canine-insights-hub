import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, Loader2, Menu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import type { Property } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type ReportLocation = Pick<Property, "id" | "name" | "public_report_token">;

export function ExternalReportLocationNav({ currentPropertyId }: { currentPropertyId: string }) {
  const navigate = useNavigate();
  const { user, loading: authLoading, roleLoading } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const [open, setOpen] = useState(false);
  const [properties, setProperties] = useState<ReportLocation[] | null>(null);

  const visible = !!user && effectiveRole === "super_admin";

  useEffect(() => {
    if (!visible || authLoading || roleLoading) {
      setProperties(null);
      return;
    }

    let cancelled = false;
    supabase
      .from("properties")
      .select("id,name,public_report_token")
      .eq("is_active", true)
      .not("public_report_token", "is", null)
      .order("name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load external report locations", error);
          setProperties([]);
          return;
        }
        setProperties((data ?? []) as ReportLocation[]);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, authLoading, roleLoading]);

  if (!visible) return null;

  const selectProperty = (property: ReportLocation) => {
    setOpen(false);
    if (!property.public_report_token || property.id === currentPropertyId) return;
    navigate(`/report/${property.public_report_token}`);
  };

  return (
    <>
      <div className="fixed left-3 top-3 z-50">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Switch report location"
          aria-label="Switch report location"
          className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Menu className="size-4" />
        </button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-4">
            <SheetTitle>External Reports</SheetTitle>
          </SheetHeader>
          <nav className="flex max-h-[calc(100vh-73px)] flex-col overflow-y-auto p-2" aria-label="Report locations">
            {properties === null ? (
              <div className="grid place-items-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : properties.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">No active locations with report links found.</p>
            ) : (
              properties.map((property) => {
                const active = property.id === currentPropertyId;
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => selectProperty(property)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "hover:bg-accent/60 hover:text-accent-foreground",
                    )}
                  >
                    <Building2 className="size-4 shrink-0" />
                    <span className="truncate">{property.name}</span>
                  </button>
                );
              })
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
