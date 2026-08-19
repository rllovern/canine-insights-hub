import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { BackendUnavailable } from "@/components/BackendUnavailable";

export default function Index() {
  const { user, loading, backendUnavailable, retryBackend } = useAuth();
  if (backendUnavailable) {
    return <BackendUnavailable onRetry={retryBackend} />;
  }
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return <Navigate to={user ? "/command" : "/login"} replace />;
}
