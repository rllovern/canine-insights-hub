import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { useTour } from "./TourContext";
import { TOUR_KEY } from "@/lib/tour/steps";

export const BOB_INTRO_KEY = "bob-intro-v1";

const BLOCKED_ROUTES = ["/login", "/reset-password", "/change-password", "/auth"];

type BobIntroValue = {
  open: boolean;
  /** Manually re-open the explainer (Help area). */
  show: () => void;
  /** Close and remember that it has been seen. */
  dismiss: () => void;
};

const Ctx = createContext<BobIntroValue | null>(null);

export function useBobIntro() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBobIntro must be used inside BobIntroProvider");
  return v;
}

export async function markBobIntroSeen(userId: string) {
  await supabase
    .from("user_tour_state")
    .upsert(
      { user_id: userId, tour_key: BOB_INTRO_KEY, completed_at: new Date().toISOString() },
      { onConflict: "user_id,tour_key" },
    );
}

export function BobIntroProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { running } = useTour();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const checked = useRef(false);

  useEffect(() => {
    checked.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (checked.current) return;
    if (!user?.id) return;
    if (running) return;
    if (BLOCKED_ROUTES.some((r) => location.pathname.startsWith(r))) return;
    checked.current = true;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_tour_state")
        .select("tour_key,completed_at,dismissed_at")
        .eq("user_id", user.id)
        .in("tour_key", [TOUR_KEY, BOB_INTRO_KEY]);
      if (cancelled) return;
      const rowFor = (k: string) => data?.find((r) => r.tour_key === k);
      const seen = (r?: { completed_at: string | null; dismissed_at: string | null }) =>
        !!r && (!!r.completed_at || !!r.dismissed_at);

      // Already met Bob — never show it again.
      if (seen(rowFor(BOB_INTRO_KEY))) return;
      // Brand new user: the walkthrough covers Bob, so skip the modal.
      if (!seen(rowFor(TOUR_KEY))) return;
      // Give the dashboard a beat to paint.
      setTimeout(() => {
        if (!cancelled) setOpen(true);
      }, 900);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, running, location.pathname]);

  const show = useCallback(() => setOpen(true), []);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (user?.id) void markBobIntroSeen(user.id);
  }, [user?.id]);

  const value = useMemo(() => ({ open, show, dismiss }), [open, show, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
