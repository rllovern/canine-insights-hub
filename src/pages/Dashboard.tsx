import { Link } from "react-router-dom";
import { useProperties } from "@/contexts/PropertyContext";
import { PageHeader } from "@/components/data/PageHeader";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";
import { EmptyState } from "@/components/data/EmptyState";
import { Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

export default function Dashboard() {
  const { properties, loading } = useProperties();
  const { effectiveRole } = usePreviewMode();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title="All properties"
        description="A bird's-eye view of every Ridgeside Canine location's marketing performance."
        actions={
          effectiveRole === "internal" && (
            <Button asChild size="sm">
              <Link to="/admin/properties">Manage properties</Link>
            </Button>
          )
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />
          ))}
        </div>
      ) : properties.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" />}
          title="No properties yet"
          description={
            effectiveRole === "internal"
              ? "Create your first property to start tracking marketing performance."
              : "You don't have access to any properties yet. Ask your admin to assign you."
          }
          action={
            effectiveRole === "internal" && (
              <Button asChild>
                <Link to="/admin/properties">Create property</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => (
            <Link
              key={p.id}
              to={`/properties/${p.slug}`}
              className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center gap-3">
                <PropertyAvatar property={p} size="lg" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">/{p.slug}</div>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spend</div>
                  <div className="mt-0.5 text-sm font-semibold text-muted-foreground">—</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Calls</div>
                  <div className="mt-0.5 text-sm font-semibold text-muted-foreground">—</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">CPL</div>
                  <div className="mt-0.5 text-sm font-semibold text-muted-foreground">—</div>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground">
                Last synced: <span className="text-foreground/70">never</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}