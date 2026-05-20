import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useProperties } from "@/contexts/PropertyContext";
import { PreviewModeContext } from "@/contexts/PreviewModeContext";
import { PublicShell } from "@/components/layout/PublicShell";
import { PublicReportToolbar } from "@/components/layout/PublicReportToolbar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import CallTracking from "@/pages/CallTracking";

const STORAGE_KEY = "adminClientReports.lastPropertyId";

// Force the inner subtree to render as a viewer so the report is pixel-identical
// to what the client sees at /report/:token (e.g. hides spam/bad-lead columns).
const VIEWER_PREVIEW_VALUE = {
  realRole: "viewer" as const,
  effectiveRole: "viewer" as const,
  isPreviewing: false,
  togglePreview: () => {},
  setPreviewing: () => {},
};

export default function AdminClientReports() {
  const { setActiveProperty } = useProperties();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    supabase
      .from("properties")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load properties", error);
          setProperties([]);
          return;
        }
        const list = (data ?? []) as Property[];
        setProperties(list);
        const stored = localStorage.getItem(STORAGE_KEY);
        const startIdx = Math.max(0, list.findIndex((p) => p.id === stored));
        setIndex(startIdx === -1 ? 0 : startIdx);
      });
  }, []);

  const current = useMemo(
    () => (properties && properties.length > 0 ? properties[index] : null),
    [properties, index],
  );

  useEffect(() => {
    if (!current) return;
    setActiveProperty(current);
    localStorage.setItem(STORAGE_KEY, current.id);
  }, [current, setActiveProperty]);

  // Keyboard arrows cycle properties.
  useEffect(() => {
    if (!properties || properties.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + properties.length) % properties.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % properties.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [properties]);

  if (!properties) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">
        No active properties found.
      </div>
    );
  }

  if (!current) return null;

  const prev = () => setIndex((i) => (i - 1 + properties.length) % properties.length);
  const next = () => setIndex((i) => (i + 1) % properties.length);

  return (
    <div className="space-y-4">
      {/* Internal-only control bar */}
      <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Eye className="size-3.5" />
            <span className="uppercase tracking-wider">Internal preview</span>
            <span className="text-muted-foreground normal-case tracking-normal">
              · Clients do not see this page
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={prev} aria-label="Previous client">
              <ChevronLeft className="size-4" />
            </Button>
            <Select
              value={current.id}
              onValueChange={(v) => {
                const i = properties.findIndex((p) => p.id === v);
                if (i >= 0) setIndex(i);
              }}
            >
              <SelectTrigger className="h-9 min-w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-50 bg-popover">
                {properties.map((p, i) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    <span className="ml-2 text-muted-foreground">
                      ({i + 1}/{properties.length})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={next} aria-label="Next client">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Pixel-identical public report view (forced viewer role) */}
      <PreviewModeContext.Provider value={VIEWER_PREVIEW_VALUE}>
        <div className="rounded-lg border border-border overflow-hidden">
          <PublicShell property={current} toolbar={<PublicReportToolbar />}>
            <div className="space-y-8">
              <Dashboard />
              <CallTracking />
            </div>
          </PublicShell>
        </div>
      </PreviewModeContext.Provider>
    </div>
  );
}