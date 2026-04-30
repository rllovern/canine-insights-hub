import { PageHeader } from "@/components/data/PageHeader";
import { EmptyState } from "@/components/data/EmptyState";
import { Sparkles } from "lucide-react";

export default function Assistant() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <PageHeader title="AI Assistant" description="Ask questions about your marketing performance in natural language." />
      <EmptyState icon={<Sparkles className="h-5 w-5" />} title="AI Assistant — coming soon" description="The conversational analytics agent ships in a later phase." />
    </div>
  );
}