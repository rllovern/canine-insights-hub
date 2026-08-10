import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/types";

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  roleLoading: boolean;
  mustChangePassword: boolean;
  securityLoading: boolean;
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

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) { setRole(null); setRoleLoading(false); return; }
    setRoleLoading(true);
    supabase.from("user_roles").select("role").eq("user_id", user.id).then(({ data }) => {
      setRole(((data?.[0]?.role as AppRole) ?? null));
      setRoleLoading(false);
    });
  }, [user]);

  const loadSecurity = async (userId: string) => {
    setSecurityLoading(true);
    const { data } = await supabase
      .from("user_security")
      .select("must_change_password")
      .eq("user_id", userId)
      .maybeSingle();
    setMustChangePassword(Boolean(data?.must_change_password));
    setSecurityLoading(false);
  };

  useEffect(() => {
    if (!user) { setMustChangePassword(false); setSecurityLoading(false); return; }
    loadSecurity(user.id);
  }, [user]);

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