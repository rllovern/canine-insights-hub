import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useProperties } from "@/contexts/PropertyContext";
import { PreviewModeContext } from "@/contexts/PreviewModeContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TokenReport } from "@/components/reports/TokenReport";

const STORAGE_KEY = "adminClientReports.lastPropertyId";

// Force the inner subtree to render as a viewer so the report is pixel-identical
// to what the client sees at /report/:token.
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
      .not("public_report_token", "is", null)
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
        const found = list.findIndex((p) => p.id === stored);
        setIndex(found >= 0 ? found : 0);
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

  useEffect(() => {
    if (!properties || properties.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + properties.length) % properties.length);
      if (e.key === "ArrowRight") setIndex((i) => (i + 1) % properties.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [properties]);

  if (!properties) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        No active properties with a share token found.
      </div>
    );
  }

  if (!current || !current.public_report_token) return null;

  const prev = () => setIndex((i) => (i - 1 + properties.length) % properties.length);
  const next = () => setIndex((i) => (i + 1) % properties.length);

  const switcher = (
    <div className="flex items-center gap-1.5">
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
        <SelectTrigger className="h-9 min-w-48 text-xs">
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
  );

  return (
    <PreviewModeContext.Provider value={VIEWER_PREVIEW_VALUE}>
      <TokenReport
        key={current.public_report_token}
        token={current.public_report_token}
        property={current}
        toolbarLeading={switcher}
      />
    </PreviewModeContext.Provider>
  );
}