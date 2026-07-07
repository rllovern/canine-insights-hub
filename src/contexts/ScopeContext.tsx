import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useProperties } from "./PropertyContext";
import { usePreviewMode } from "./PreviewModeContext";
import type { Property } from "@/lib/types";

export type ScopeMode = "agency" | "property";

export interface ScopeValue {
  mode: ScopeMode;
  propertyId: string | null;
  /** null = unrestricted (internal agency view); otherwise the explicit list of accessible property ids */
  propertyIds: string[] | null;
  activeProperty: Property | null;
  setScope: (next: { mode: ScopeMode; propertyId?: string | null }) => void;
  label: string;
}

const ScopeCtx = createContext<ScopeValue | undefined>(undefined);

const STORAGE_KEY = "scope.v1";

type Stored = { mode: ScopeMode; propertyId: string | null };

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (v && (v.mode === "agency" || v.mode === "property")) return v;
    return null;
  } catch { return null; }
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { properties, loading } = useProperties();
  const { effectiveRole, isAllPropertiesReader, isLocationOwner } = usePreviewMode();
  const [mode, setMode] = useState<ScopeMode>("agency");
  const [propertyId, setPropertyId] = useState<string | null>(null);

  // Hydrate from storage / sensible defaults once properties load.
  useEffect(() => {
    if (loading) return;
    // Location Owner: force property scope to their (single) assigned property.
    if (isLocationOwner) {
      const first = properties[0] ?? null;
      setMode("property");
      setPropertyId(first?.id ?? null);
      return;
    }
    const stored = readStored();
    if (stored) {
      // If a stored property id no longer exists, fall back to agency.
      if (stored.mode === "property" && (!stored.propertyId || !properties.find((p) => p.id === stored.propertyId))) {
        setMode("agency"); setPropertyId(null);
      } else {
        setMode(stored.mode);
        setPropertyId(stored.propertyId ?? null);
      }
      return;
    }
    // Defaults: agency view for everyone else.
    setMode("agency"); setPropertyId(null);
  }, [loading, properties, isLocationOwner]);

  const setScope = useCallback((next: { mode: ScopeMode; propertyId?: string | null }) => {
    const nextMode = next.mode;
    const nextPid = nextMode === "property" ? (next.propertyId ?? null) : null;
    setMode(nextMode);
    setPropertyId(nextPid);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: nextMode, propertyId: nextPid })); } catch { /* ignore */ }
  }, []);

  const value = useMemo<ScopeValue>(() => {
    const activeProperty = mode === "property" ? (properties.find((p) => p.id === propertyId) ?? null) : null;
    // All-properties readers in agency mode → null (unrestricted).
    // Everyone else → explicit list of accessible ids.
    let propertyIds: string[] | null;
    if (mode === "property") {
      propertyIds = propertyId ? [propertyId] : [];
    } else if (isAllPropertiesReader) {
      propertyIds = null;
    } else {
      propertyIds = properties.map((p) => p.id);
    }
    const label = mode === "agency"
      ? (isAllPropertiesReader ? "All locations" : "All my properties")
      : (activeProperty?.name ?? "Unknown property");
    return { mode, propertyId, propertyIds, activeProperty, setScope, label };
  }, [mode, propertyId, properties, isAllPropertiesReader, setScope]);

  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

export function useScope() {
  const v = useContext(ScopeCtx);
  if (!v) throw new Error("useScope must be used within ScopeProvider");
  return v;
}