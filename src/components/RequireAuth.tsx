import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { AppRole } from "@/lib/types";

interface RequireAuthProps {
  children: ReactNode;
  /** Require the *real* role, not the previewed one. Use for admin-only routes. */
  requireRealRole?: AppRole;
}

export function RequireAuth({ children, requireRealRole }: RequireAuthProps) {
  const { user, loading, roleLoading } = useAuth();
  const { realRole } = usePreviewMode();

  if (loading || (requireRealRole && user && roleLoading)) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requireRealRole && realRole !== requireRealRole) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}