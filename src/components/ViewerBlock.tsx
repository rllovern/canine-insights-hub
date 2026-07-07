import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

/**
 * Blocks Location Owner (and Super Admin previewing as one) from reaching
 * routes outside their allowed surfaces (Command + Budget Pacing). Everyone
 * above Location Owner (Super Admin, Admin, Owner) passes through.
 */
export function ViewerBlock({ children }: { children: ReactNode }) {
  const { isLocationOwner } = usePreviewMode();
  if (isLocationOwner) return <Navigate to="/command" replace />;
  return <>{children}</>;
}