import { PageHeader } from "@/components/data/PageHeader";

export default function AdminSettings() {
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <PageHeader title="Settings" description="Workspace and integration preferences." />
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Settings UI coming with the next prompt.
      </div>
    </div>
  );
}