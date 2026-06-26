import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Menu, Building2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useScope } from "@/contexts/ScopeContext";
import { PreviewModeContext } from "@/contexts/PreviewModeContext";
import { TokenReport } from "@/components/reports/TokenReport";
import { exportNodeToPdf } from "@/lib/exportPdf";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "adminClientReports.lastPropertyId";

// Force the inner subtree to render as a viewer so the report is pixel-identical
// to what the client sees at /report/:token.
const VIEWER_PREVIEW_VALUE = {
  realRole: "viewer" as const,
  effectiveRole: "viewer" as const,
  impersonateBob: false,
  toggleBob: () => {},
  impersonatedUserId: null,
  isOwner: false,
};

export default function AdminClientReports() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();
  const { setScope } = useScope();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);

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
        setProperties((data ?? []) as Property[]);
      });
  }, []);

  // Default-select a property when arriving without one in the URL.
  useEffect(() => {
    if (!properties || properties.length === 0 || propertyId) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = properties.find((p) => p.id === stored) ?? properties[0];
    navigate(`/admin/client-reports/${initial.id}`, { replace: true });
  }, [properties, propertyId, navigate]);

  const current = properties?.find((p) => p.id === propertyId) ?? null;

  useEffect(() => {
    if (!current) return;
    setScope({ mode: "property", propertyId: current.id });
    localStorage.setItem(STORAGE_KEY, current.id);
  }, [current, setScope]);

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

  const selectProperty = (id: string) => {
    setDrawerOpen(false);
    if (id !== propertyId) navigate(`/admin/client-reports/${id}`);
  };

  const handleDownload = async () => {
    if (!captureRef.current || !current) return;
    setDownloading(true);
    try {
      const safeName = current.name.replace(/[^a-z0-9-_ ]/gi, "").trim();
      const filename = `${safeName} - Performance Report - ${format(new Date(), "yyyy-MM-dd")}.pdf`;
      await exportNodeToPdf(captureRef.current, filename);
      toast.success("PDF downloaded");
    } catch (err) {
      console.error("PDF export failed", err);
      toast.error("Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full">
      {/* Floating top-left controls overlaid on the report */}
      <div className="fixed left-3 top-3 z-50 flex items-center gap-1.5">
        <button
          onClick={() => setDrawerOpen(true)}
          title="Open clients"
          aria-label="Open clients"
          className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <Menu className="size-4" />
        </button>
        <button
          onClick={() => navigate("/dashboard")}
          title="Back to dashboard"
          aria-label="Back to dashboard"
          className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </button>
      </div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-4">
            <SheetTitle>Clients</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col p-2 overflow-y-auto">
            {properties.map((p) => {
              const active = p.id === propertyId;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProperty(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-left transition-colors",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "hover:bg-accent/60 hover:text-accent-foreground"
                  )}
                >
                  <Building2 className="size-4 shrink-0" />
                  <span className="truncate">{p.name}</span>
                </button>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>

      {current && current.public_report_token ? (
        <PreviewModeContext.Provider value={VIEWER_PREVIEW_VALUE}>
          <TokenReport
            ref={captureRef}
            key={current.public_report_token}
            token={current.public_report_token}
            property={current}
            toolbarExtras={
              <button
                onClick={handleDownload}
                disabled={downloading}
                title="Download PDF"
                aria-label="Download PDF"
                data-html2canvas-ignore="true"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {downloading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                <span>{downloading ? "Generating…" : "Download PDF"}</span>
              </button>
            }
          />
        </PreviewModeContext.Provider>
      ) : (
        <div className="grid min-h-screen place-items-center">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}