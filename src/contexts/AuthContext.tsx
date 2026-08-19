import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/types";

/** How long the auth gate waits for the backend before showing an error screen. */
const AUTH_TIMEOUT_MS = 12_000;

const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
      }),
    ]);
  } catch {
    return TIMED_OUT;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  roleLoading: boolean;
  mustChangePassword: boolean;
  securityLoading: boolean;
  /** True when a required auth/profile request did not come back in time. */
  backendUnavailable: boolean;
  /** Re-runs the session, role and security lookups without signing the user out. */
  retryBackend: () => void;
  refreshSecurity: () => Promise<void>;
  clearMustChangePassword: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retryBackend = useCallback(() => {
    setBackendUnavailable(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (cancelled) return;
      setSession(s);
      setUser(s?.user ?? null);
      setBackendUnavailable(false);
      setLoading(false);
    });
    (async () => {
      const res = await withTimeout(supabase.auth.getSession(), AUTH_TIMEOUT_MS);
      if (cancelled) return;
      if (res === TIMED_OUT) {
        setBackendUnavailable(true);
        setLoading(false);
        return;
      }
      const s = res.data.session;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [attempt]);

  useEffect(() => {
    if (!user) { setRole(null); setRoleLoading(false); return; }
    let cancelled = false;
    setRoleLoading(true);
    (async () => {
      const res = await withTimeout(
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        AUTH_TIMEOUT_MS,
      );
      if (cancelled) return;
      if (res === TIMED_OUT) {
        setBackendUnavailable(true);
        setRoleLoading(false);
        return;
      }
      setRole(((res.data?.[0]?.role as AppRole) ?? null));
      setRoleLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, attempt]);

  const loadSecurity = async (userId: string) => {
    setSecurityLoading(true);
    const res = await withTimeout(
      supabase
        .from("user_security")
        .select("must_change_password")
        .eq("user_id", userId)
        .maybeSingle(),
      AUTH_TIMEOUT_MS,
    );
    if (res === TIMED_OUT) {
      setBackendUnavailable(true);
      setSecurityLoading(false);
      return;
    }
    setMustChangePassword(Boolean(res.data?.must_change_password));
    setSecurityLoading(false);
  };

  useEffect(() => {
    if (!user) { setMustChangePassword(false); setSecurityLoading(false); return; }
    loadSecurity(user.id);
  }, [user, attempt]);

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        role,
        loading,
        roleLoading,
        mustChangePassword,
        securityLoading,
        backendUnavailable,
        retryBackend,
        refreshSecurity: async () => { if (user) await loadSecurity(user.id); },
        clearMustChangePassword: () => setMustChangePassword(false),
        signOut: async () => { await supabase.auth.signOut(); },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);