import { useState } from "react";
import { Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useNotices } from "@/contexts/NoticeContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Shown to staff who are allowed through while everyone else is locked out. */
export function MaintenanceAdminBanner() {
  const { maintenanceOn, reload } = useNotices();
  const { effectiveRole, realRole } = usePreviewMode();
  const [busy, setBusy] = useState(false);

  const isStaffViewer =
    effectiveRole === "super_admin" || effectiveRole === "admin" || realRole === "super_admin";
  if (!maintenanceOn || !isStaffViewer) return null;

  const turnOff = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("maintenance_mode")
      .update({ active: false, scheduled_start: null, scheduled_end: null })
      .eq("id", 1);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Maintenance mode turned off");
    void reload();
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
      <Wrench className="h-4 w-4 text-amber-600" />
      <span className="text-[12px] font-medium text-amber-700 dark:text-amber-400">
        Maintenance mode is ON for all other users
      </span>
      {realRole === "super_admin" && (
        <Button size="sm" variant="outline" className="ml-auto h-7" disabled={busy} onClick={turnOff}>
          Turn off
        </Button>
      )}
    </div>
  );
}
