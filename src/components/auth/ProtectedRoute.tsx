import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children, internalOnly }: { children: ReactNode; internalOnly?: boolean }) {
  const { user, role, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (internalOnly && role !== "internal") return <Navigate to="/" replace />;
  return <>{children}</>;
}
