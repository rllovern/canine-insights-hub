import type { ReactNode } from "react";
import { useNotices } from "@/contexts/NoticeContext";
import { MaintenancePage } from "./MaintenancePage";

/**
 * Blocks a route while maintenance is in effect. Super Admins and Admins pass
 * through. Never wrap /onboarding/:token with this.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const { loading, blockedByMaintenance } = useNotices();
  if (loading) return null;
  if (blockedByMaintenance) return <MaintenancePage />;
  return <>{children}</>;
}
