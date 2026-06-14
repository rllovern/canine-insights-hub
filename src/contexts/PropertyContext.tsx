import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Property } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { usePreviewMode } from "./PreviewModeContext";

interface PropertyContextValue {
  properties: Property[];
  loading: boolean;
  reload: () => Promise<void>;
  /** @deprecated Use `useScope().activeProperty`. Kept for legacy components. */
  activeProperty: Property | null;
  /** @deprecated Use `useScope().setScope({ mode: "property", propertyId })`. */
  setActiveProperty: (p: Property | null) => void;
}

const PropertyContext = createContext<PropertyContextValue | undefined>(undefined);

export function PropertyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProperty, setActivePropertyState] = useState<Property | null>(null);

  const setActiveProperty = useCallback((p: Property | null) => {
    setActivePropertyState(p);
    if (p) localStorage.setItem("activePropertyId", p.id);
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      setProperties([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let query = supabase.from("properties").select("*").order("name");

    // Internal previewing-as-viewer: filter client-side to assigned set
    if (effectiveRole === "viewer") {
      const { data: access } = await supabase
        .from("viewer_property_access")
        .select("property_id")
        .eq("user_id", user.id);
      const ids = (access ?? []).map((a) => a.property_id);
      if (ids.length === 0) {
        setProperties([]);
        setLoading(false);
        return;
      }
      query = query.in("id", ids);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Load properties failed", error);
      setProperties([]);
    } else {
      const list = (data ?? []) as Property[];
      setProperties(list);
      const stored = localStorage.getItem("activePropertyId");
      const found = list.find((p) => p.id === stored) ?? list[0] ?? null;
      setActivePropertyState(found);
    }
    setLoading(false);
  }, [user, effectiveRole]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PropertyContext.Provider value={{ properties, loading, reload: load, activeProperty, setActiveProperty }}>
      {children}
    </PropertyContext.Provider>
  );
}

export function useProperties() {
  const ctx = useContext(PropertyContext);
  if (!ctx) throw new Error("useProperties must be used within PropertyProvider");
  return ctx;
}