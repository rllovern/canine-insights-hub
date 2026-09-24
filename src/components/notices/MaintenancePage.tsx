import { Wrench } from "lucide-react";
import { eastern, useNotices } from "@/contexts/NoticeContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { Button } from "@/components/ui/button";

export function MaintenancePage() {
  const { maintenance, maintenanceOn, lockoutNotice } = useNotices();
  const { isPreviewing, setPreviewRole } = usePreviewMode();

  // A data-outage lockout explains the delay, not scheduled maintenance.
  const useIncident = !maintenanceOn && !!lockoutNotice;
  const title = useIncident ? lockoutNotice!.title : null;
  const message = useIncident
    ? lockoutNotice!.body
    : maintenance?.message ?? "The dashboard is down for scheduled maintenance.";
  const back = useIncident ? null : maintenance?.expected_back_at ?? null;

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
          <Wrench className="h-5 w-5 text-muted-foreground" />
        </div>
        {title && <p className="text-lg font-semibold">{title}</p>}
        <p className="text-base whitespace-pre-wrap">{message}</p>
        {back && (
          <p className="text-sm text-muted-foreground">Expected back at {eastern(back)}</p>
        )}
        {isPreviewing && (
          <Button variant="outline" size="sm" onClick={() => setPreviewRole("super_admin")}>
            Exit preview (back to Super Admin)
          </Button>
        )}
      </div>
    </div>
  );
}
