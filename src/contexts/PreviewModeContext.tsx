import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { AppRole } from "@/lib/types";
import { useAuth } from "./AuthContext";

interface PreviewModeContextValue {
  /** The role actually granted by the database. */
  realRole: AppRole | null;
  /** The role currently being previewed in the UI (only differs from realRole when an internal user previews as viewer). */
  effectiveRole: AppRole | null;
  isPreviewing: boolean;
  togglePreview: () => void;
  setPreviewing: (v: boolean) => void;
}

const PreviewModeContext = createContext<PreviewModeContextValue | undefined>(undefined);

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const { roles } = useAuth();
  const [previewing, setPreviewing] = useState(false);

  const realRole: AppRole | null = useMemo(() => {
    if (roles.includes("internal")) return "internal";
    if (roles.includes("viewer")) return "viewer";
    return null;
  }, [roles]);

  const effectiveRole: AppRole | null = useMemo(() => {
    if (realRole === "internal" && previewing) return "viewer";
    return realRole;
  }, [realRole, previewing]);

  const togglePreview = () => setPreviewing((p) => !p);

  return (
    <PreviewModeContext.Provider
      value={{ realRole, effectiveRole, isPreviewing: previewing, togglePreview, setPreviewing }}
    >
      {children}
    </PreviewModeContext.Provider>
  );
}

export function usePreviewMode() {
  const ctx = useContext(PreviewModeContext);
  if (!ctx) throw new Error("usePreviewMode must be used within PreviewModeProvider");
  return ctx;
}