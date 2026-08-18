import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useBob } from "@/contexts/BobContext";

/**
 * Bob no longer lives on his own page — he is a drawer. This route just opens
 * the drawer and bounces back to the dashboard so old links keep working.
 */
export default function Assistant() {
  const { openBob, openBobSession } = useBob();
  const [params] = useSearchParams();
  const session = params.get("session");
  useEffect(() => {
    if (session) openBobSession(session);
    else openBob();
  }, [session, openBob, openBobSession]);
  return <Navigate to="/command" replace />;
}
