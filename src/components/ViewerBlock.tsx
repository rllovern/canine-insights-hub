import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

/**
 * Belt-and-suspenders: hides routes that viewers (and the owner impersonating
 * Bob) should never be able to reach by typing the URL. Sidebar already hides
 * the links; this redirects deep-linked URLs back to /command.
 */
export function ViewerBlock({ children }: { children: ReactNode }) {
  const { effectiveRole } = usePreviewMode();
  if (effectiveRole !== "internal") return <Navigate to="/command" replace />;
  return <>{children}</>;
}