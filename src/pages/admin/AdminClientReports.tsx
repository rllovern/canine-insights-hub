import { useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useProperties } from "@/contexts/PropertyContext";
import { PreviewModeContext } from "@/contexts/PreviewModeContext";
import { TokenReport } from "@/components/reports/TokenReport";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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
  const { propertyId } = useParams<{ propertyId: string }>();
  const navigate = useNavigate();
  const { setActiveProperty } = useProperties();
  const [properties, setProperties] = useState<Property[] | null>(null);

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

  // Default-select a property when arriving at /admin/client-reports.
  useEffect(() => {
    if (!properties || properties.length === 0 || propertyId) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    const initial = properties.find((p) => p.id === stored) ?? properties[0];
    navigate(`/admin/client-reports/${initial.id}`, { replace: true });
  }, [properties, propertyId, navigate]);

  const current = properties?.find((p) => p.id === propertyId) ?? null;

  useEffect(() => {
    if (!current) return;
    setActiveProperty(current);
    localStorage.setItem(STORAGE_KEY, current.id);
  }, [current, setActiveProperty]);

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

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-screen w-full">
        <Sidebar collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border">
            <button
              onClick={() => navigate("/dashboard")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
              title="Back to internal dashboard"
            >
              <ArrowLeft className="size-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">Back to dashboard</span>
            </button>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Clients</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {properties.map((p) => {
                    const active = p.id === propertyId;
                    return (
                      <SidebarMenuItem key={p.id}>
                        <SidebarMenuButton asChild isActive={active} tooltip={p.name}>
                          <NavLink
                            to={`/admin/client-reports/${p.id}`}
                            className={cn("flex items-center gap-2")}
                          >
                            <Building2 className="size-4 shrink-0" />
                            <span className="truncate">{p.name}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <div className="relative flex-1 min-w-0">
          {/* Floating trigger so the sidebar can be reopened when collapsed/offcanvas */}
          <SidebarTrigger className="absolute left-2 top-2 z-40 bg-background/80 backdrop-blur" />
          {current && current.public_report_token ? (
            <PreviewModeContext.Provider value={VIEWER_PREVIEW_VALUE}>
              <TokenReport
                key={current.public_report_token}
                token={current.public_report_token}
                property={current}
              />
            </PreviewModeContext.Provider>
          ) : (
            <div className="grid min-h-screen place-items-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </SidebarProvider>
  );
}