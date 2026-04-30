import { PageHeader } from "@/components/data/PageHeader";
import { EmptyState } from "@/components/data/EmptyState";

export default function Reports() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader title="Reports" description="Saved and exported views." />
      <EmptyState title="Reports — coming soon" description="Save filtered views and export branded PDFs in a later phase." />
    </div>
  );
}