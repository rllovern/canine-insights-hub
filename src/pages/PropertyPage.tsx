import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useProperties } from "@/contexts/PropertyContext";
import { PageHeader } from "@/components/data/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PropertyOverview } from "@/components/data/PropertyOverview";
import { EmptyState } from "@/components/data/EmptyState";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";

export default function PropertyPage() {
  const { slug } = useParams();
  const { properties, loading } = useProperties();
  const [tab, setTab] = useState("overview");

  // sync hash → tab
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (["overview", "ppc", "calls", "web"].includes(h)) setTab(h);
  }, [slug]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const property = properties.find((p) => p.slug === slug);
  if (!property) return <Navigate to="/dashboard" replace />;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <PageHeader
        title={property.name}
        description="Marketing performance across paid, organic, and call channels."
        actions={
          <div className="flex items-center gap-2">
            <PropertyAvatar property={property} size="sm" />
            <span className="text-xs text-muted-foreground">/{property.slug}</span>
          </div>
        }
      />
      <Tabs value={tab} onValueChange={(v) => { setTab(v); window.location.hash = v; }}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ppc">PPC</TabsTrigger>
          <TabsTrigger value="calls">Call Tracking</TabsTrigger>
          <TabsTrigger value="web">Web Analytics</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-6">
          <PropertyOverview />
        </TabsContent>
        <TabsContent value="ppc" className="mt-6">
          <EmptyState title="PPC — coming soon" description="Google Ads integration arrives in the next phase." />
        </TabsContent>
        <TabsContent value="calls" className="mt-6">
          <EmptyState title="Call Tracking — coming soon" description="CallTrackingMetrics integration arrives in the next phase." />
        </TabsContent>
        <TabsContent value="web" className="mt-6">
          <EmptyState title="Web Analytics — coming soon" description="GA4 integration arrives in the next phase." />
        </TabsContent>
      </Tabs>
    </div>
  );
}