import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

/**
 * Blocks Owner and Location Owner (real or previewed) from reaching routes
 * outside their allowed surfaces (Command + Budget Pacing). Super Admin and
 * Admin pass through.
 */
export function ViewerBlock({ children }: { children: ReactNode }) {
  const { effectiveRole } = usePreviewMode();
  if (effectiveRole === "location_owner" || effectiveRole === "owner") {
    return <Navigate to="/command" replace />;
  }
  return <>{children}</>;
}