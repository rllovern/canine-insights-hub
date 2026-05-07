import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "internal" | "viewer";

export interface Property {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string | null;
  /** Per-client metric label overrides, e.g. {"admissions":"Sales"}. */
  metric_labels?: Record<string, string> | null;
  /** Per-client hidden metric keys, e.g. ["medicaid"]. */
  hidden_metrics?: string[] | null;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  effectiveRole: AppRole | null;
  viewAsViewer: boolean;
  setViewAsViewer: (v: boolean) => void;
  loading: boolean;
  clients: Property[];
  activeProperty: Property | null;
  setActiveProperty: (c: Property | null) => void;
  signOut: () => Promise<void>;
  /** True when this provider is the public (token-based) report, not an authenticated session. */
  isPublicReport?: boolean;
}

const Ctx = createContext<AuthCtx>({} as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [clients, setClients] = useState<Property[]>([]);
  const [activeProperty, setActivePropertyState] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);

  // Listener first, then session check (per Lovable Cloud guidance)
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
    if (!user) { setRole(null); setClients([]); setActivePropertyState(null); return; }
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const r = (roles?.[0]?.role as AppRole | undefined) ?? null;
      setRole(r);

      const { data: cl } = await supabase.from("properties").select("*").order("name");
      const list = (cl ?? []) as Property[];
      setClients(list);
      // restore last active client
      const stored = localStorage.getItem("activeProperty_Id");
      const found = list.find((c) => c.id === stored) ?? list[0] ?? null;
      setActivePropertyState(found);
    })();
  }, [user]);

  const setActiveProperty = (c: Property | null) => {
    setActivePropertyState(c);
    if (c) localStorage.setItem("activeProperty_Id", c.id);
  };

  const [viewAsViewer, setViewAsClientState] = useState<boolean>(() => localStorage.getItem("viewAsViewer") === "1");
  const setViewAsViewer = (v: boolean) => {
    setViewAsClientState(v);
    localStorage.setItem("viewAsViewer", v ? "1" : "0");
  };
  const effectiveRole: AppRole | null = role === "internal" && viewAsViewer ? "client" : role;

  const value = useMemo<AuthCtx>(() => ({
    user, session, role, effectiveRole, viewAsViewer, setViewAsViewer,
    loading, clients, activeProperty, setActiveProperty,
    signOut: async () => { await supabase.auth.signOut(); },
  }), [user, session, role, effectiveRole, viewAsViewer, loading, clients, activeProperty]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * A drop-in AuthProvider for the public token-based report view.
 * Exposes the same context shape so dashboard components work unchanged,
 * but skips auth completely and uses a stub "internal" role so all cards
 * (including spam) render. No client switcher; activeProperty is fixed.
 */
export function PublicAuthProvider({ client, children }: { client: Property; children: ReactNode }) {
  const value = useMemo<AuthCtx>(() => ({
    user: null,
    session: null,
    role: "internal",
    effectiveRole: "internal",
    viewAsViewer: false,
    setViewAsViewer: () => {},
    loading: false,
    clients: [client],
    activeProperty: client,
    setActiveProperty: () => {},
    signOut: async () => {},
    isPublicReport: true,
  }), [client]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
