import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";
import { usePreviewMode } from "./PreviewModeContext";
import { TOUR_KEY, stepsForRole, type TourStep } from "@/lib/tour/steps";

type TourContextValue = {
  /** Whether the tour UI is allowed to appear for this account. */
  available: boolean;
  running: boolean;
  step: TourStep | null;
  index: number;
  total: number;
  start: () => void;
  next: () => void;
  back: () => void;
  stop: (completed: boolean) => void;
};

const TourContext = createContext<TourContextValue | undefined>(undefined);

// Roles that can launch the tour manually (Help button).
const TOUR_HELP_ROLES = ["super_admin", "admin", "owner", "location_owner"];
// Routes where the tour must never auto-start (auth / onboarding screens).
const BLOCKED_AUTOSTART_ROUTES = ["/login", "/reset-password", "/change-password", "/auth"];

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { realRole, effectiveRole } = usePreviewMode();
  const navigate = useNavigate();
  const location = useLocation();

  // Admin and Location Owner roles. Super Admins previewing as one of those can
  // see it too, but the tour only auto-starts for real admins / location owners.
  const available = TOUR_HELP_ROLES.includes(effectiveRole as string);

  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const autoChecked = useRef(false);

  // Only include steps for pages this role can actually reach.
  const steps = useMemo(() => stepsForRole(effectiveRole), [effectiveRole]);
  const total = steps.length;
  const step = running ? steps[index] ?? null : null;

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!user?.id) return;
      await supabase
        .from("user_tour_state")
        .upsert(
          { user_id: user.id, tour_key: TOUR_KEY, ...patch },
          { onConflict: "user_id,tour_key" },
        );
    },
    [user?.id],
  );

  const start = useCallback(() => {
    setIndex(0);
    setRunning(true);
  }, []);

  const stop = useCallback(
    (completed: boolean) => {
      setRunning(false);
      void persist(
        completed
          ? { completed_at: new Date().toISOString(), last_step: total }
          : { dismissed_at: new Date().toISOString(), last_step: index },
      );
    },
    [index, persist, total],
  );

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= total) {
        setRunning(false);
        void persist({ completed_at: new Date().toISOString(), last_step: total });
        return 0;
      }
      return i + 1;
    });
  }, [persist, total]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Role (or preview role) changed mid-tour — keep the index in range.
  useEffect(() => {
    if (index >= total) setIndex(0);
  }, [index, total]);

  // Auto-start on first login for any signed-in user who has never finished or
  // dismissed the tour.
  useEffect(() => {
    if (autoChecked.current) return;
    if (!user?.id || !realRole) return;
    if (BLOCKED_AUTOSTART_ROUTES.some((r) => location.pathname.startsWith(r))) return;
    if (total === 0) return;
    autoChecked.current = true;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("user_tour_state")
        .select("completed_at,dismissed_at")
        .eq("user_id", user.id)
        .eq("tour_key", TOUR_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (!data || (!data.completed_at && !data.dismissed_at)) {
        setIndex(0);
        setRunning(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, realRole, location.pathname, total]);

  // New sign-in (different user) — allow the auto-start check to run again.
  useEffect(() => {
    autoChecked.current = false;
  }, [user?.id]);

  // Keep the route in sync with the current step.
  useEffect(() => {
    if (!running || !step) return;
    if (location.pathname !== step.route) navigate(step.route);
  }, [running, step, location.pathname, navigate]);

  // Escape closes the tour.
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(false);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, stop, next, back]);

  const value = useMemo<TourContextValue>(
    () => ({ available, running, step, index, total, start, next, back, stop }),
    [available, running, step, index, total, start, next, back, stop],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
