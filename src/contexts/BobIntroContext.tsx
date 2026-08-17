import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { useTour } from "./TourContext";
import { TOUR_KEY } from "@/lib/tour/steps";

export const BOB_INTRO_KEY = "bob-intro-v1";

const BLOCKED_ROUTES = ["/login", "/reset-password", "/change-password", "/auth"];

const localKey = (userId: string) => `bobIntroSeen:${userId}`;

function readLocalSeen(userId: string) {
  try {
    return localStorage.getItem(localKey(userId)) === "1";
  } catch {
    return false;
  }
}

function writeLocalSeen(userId: string) {
  try {
    localStorage.setItem(localKey(userId), "1");
  } catch {
    /* private mode / storage disabled — the server row is the fallback */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Records that this user has met Bob. Writes the local guard first (so the
 * modal can never reappear on this device), then persists to the server with
 * a couple of retries so a flaky request doesn't cause a re-introduction.
 */
export async function markBobIntroSeen(userId: string): Promise<boolean> {
  writeLocalSeen(userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase
      .from("user_tour_state")
      .upsert(
        { user_id: userId, tour_key: BOB_INTRO_KEY, completed_at: new Date().toISOString() },
        { onConflict: "user_id,tour_key" },
      );
    if (!error) return true;
    if (attempt < 2) await sleep(800 * (attempt + 1));
  }
  return false;
}

type BobIntroValue = {
  open: boolean;
  /** Manually re-open the explainer (top bar "Meet Bob"). */
  show: () => void;
  /** Close and remember, permanently, that it has been seen. */
  dismiss: () => void;
};

const Ctx = createContext<BobIntroValue | null>(null);

export function useBobIntro() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBobIntro must be used inside BobIntroProvider");
  return v;
}

export function BobIntroProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { running } = useTour();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const checked = useRef(false);
  const dismissedThisSession = useRef(false);

  // New sign-in — allow exactly one auto-open check for the new account.
  useEffect(() => {
    checked.current = false;
    dismissedThisSession.current = false;
  }, [user?.id]);

  useEffect(() => {
    if (checked.current) return;
    if (!user?.id) return;
    if (running) return;
    if (dismissedThisSession.current) return;
    if (BLOCKED_ROUTES.some((r) => location.pathname.startsWith(r))) return;
    checked.current = true;
    const userId = user.id;
    let cancelled = false;

    (async () => {
      // Local guard: already met Bob on this device, nothing to do.
      if (readLocalSeen(userId)) {
        // Heal a server record that never landed, quietly.
        void supabase
          .from("user_tour_state")
          .upsert(
            { user_id: userId, tour_key: BOB_INTRO_KEY, completed_at: new Date().toISOString() },
            { onConflict: "user_id,tour_key", ignoreDuplicates: true },
          );
        return;
      }

      const { data, error } = await supabase
        .from("user_tour_state")
        .select("tour_key,completed_at,dismissed_at")
        .eq("user_id", userId)
        .in("tour_key", [TOUR_KEY, BOB_INTRO_KEY]);
      if (cancelled) return;
      // Couldn't read state — never guess; skip rather than risk a repeat.
      if (error) return;

      const rowFor = (k: string) => data?.find((r) => r.tour_key === k);
      const seen = (r?: { completed_at: string | null; dismissed_at: string | null }) =>
        !!r && (!!r.completed_at || !!r.dismissed_at);

      // Already met Bob — never show it again.
      if (seen(rowFor(BOB_INTRO_KEY))) {
        writeLocalSeen(userId);
        return;
      }
      // Brand new user: the walkthrough covers Bob, so skip the modal.
      if (!seen(rowFor(TOUR_KEY))) return;

      // Give the dashboard a beat to paint.
      setTimeout(() => {
        if (!cancelled && !dismissedThisSession.current) setOpen(true);
      }, 900);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, running, location.pathname]);

  const show = useCallback(() => setOpen(true), []);

  const dismiss = useCallback(() => {
    setOpen(false);
    dismissedThisSession.current = true;
    if (user?.id) void markBobIntroSeen(user.id);
  }, [user?.id]);

  const value = useMemo(() => ({ open, show, dismiss }), [open, show, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
