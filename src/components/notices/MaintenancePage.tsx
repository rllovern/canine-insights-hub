import { Wrench } from "lucide-react";
import { eastern, useNotices } from "@/contexts/NoticeContext";

export function MaintenancePage() {
  const { maintenance } = useNotices();
  const message = maintenance?.message ?? "The dashboard is down for scheduled maintenance.";
  const back = maintenance?.expected_back_at ?? null;

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Wrench className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-base whitespace-pre-wrap">{message}</p>
        {back && (
          <p className="text-sm text-muted-foreground">Expected back at {eastern(back)}</p>
        )}
      </div>
    </div>
  );
}
