import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useBob } from "@/contexts/BobContext";

/**
 * Bob no longer lives on his own page — he is a drawer. This route just opens
 * the drawer and bounces back to the dashboard so old links keep working.
 */
export default function Assistant() {
  const { openBob } = useBob();
  useEffect(() => { openBob(); }, [openBob]);
  return <Navigate to="/command" replace />;
}
