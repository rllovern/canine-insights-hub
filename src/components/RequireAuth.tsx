import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";

interface RequireAuthProps {
  children: ReactNode;
  /** Require Super Admin (real role). Used for mutation-only admin routes. */
  requireSuperAdmin?: boolean;
  /** Require Super Admin or Admin (real role). Used for admin pages. */
  requireStaff?: boolean;
}

export function RequireAuth({ children, requireSuperAdmin, requireStaff }: RequireAuthProps) {
  const { user, loading, roleLoading, mustChangePassword, securityLoading } = useAuth();
  const { isSuperAdmin, isStaff } = usePreviewMode();
  const location = useLocation();

  const gated = requireSuperAdmin || requireStaff;
  if (loading || (user && securityLoading) || (gated && user && roleLoading)) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  if (requireSuperAdmin && !isSuperAdmin) return <Navigate to="/command" replace />;
  if (requireStaff && !isStaff) return <Navigate to="/command" replace />;
  return <>{children}</>;
}