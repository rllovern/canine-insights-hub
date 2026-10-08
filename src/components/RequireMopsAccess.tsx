import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMopsAccess } from "@/hooks/useMopsAccess";

export function RequireMopsAccess({ children }: { children: ReactNode }) {
  const { hasAccess, loading } = useMopsAccess();
  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  if (!hasAccess) return <Navigate to="/command" replace />;
  return <>{children}</>;
}
