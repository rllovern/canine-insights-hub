import { PageHeader } from "@/components/data/PageHeader";
import { EmptyState } from "@/components/data/EmptyState";

export default function AdminSettings() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <PageHeader
        title="Settings"
        description="Global workspace configuration and integration credentials."
      />
      <EmptyState
        title="Settings arrive in the next phase"
        description="Google Ads, CallTrackingMetrics, and GA4 connection forms will live here."
      />
    </div>
  );
}