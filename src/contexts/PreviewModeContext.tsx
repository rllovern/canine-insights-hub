import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { AppRole } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { BOB_USER_ID } from "@/lib/owners";

interface PreviewModeContextValue {
  /** The role actually granted by the database. */
  realRole: AppRole | null;
  /** Role currently being previewed in the UI. Differs from realRole only when a Super Admin flips the preview toggle. */
  effectiveRole: AppRole | null;
  /** True when a Super Admin is previewing the Location Owner UX. */
  previewingLocationOwner: boolean;
  /** Toggle preview between real role and Location Owner. Only Super Admin sees this control. */
  togglePreviewLocationOwner: () => void;
  /** Bob's auth.users id when a Super Admin is previewing, otherwise null. Used to scope property lists. */
  impersonatedUserId: string | null;
  /** True if the signed-in account is a Super Admin. */
  isSuperAdmin: boolean;
  /** Super Admin OR Admin (internal staff). */
  isStaff: boolean;
  /** Super Admin OR Admin OR Owner — sees all properties and every metric. */
  isAllPropertiesReader: boolean;
  /** True when the effective role is location_owner (real or previewed). */
  isLocationOwner: boolean;

  // ---- Back-compat aliases so existing components keep compiling ----
  /** @deprecated use isSuperAdmin. */
  isOwner: boolean;
  /** @deprecated use previewingLocationOwner. */
  impersonateBob: boolean;
  /** @deprecated use togglePreviewLocationOwner. */
  toggleBob: () => void;
}

export const PreviewModeContext = createContext<PreviewModeContextValue | undefined>(undefined);

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const [previewingLocationOwner, setPreviewing] = useState<boolean>(() => {
    try { return localStorage.getItem("preview.location_owner") === "1"; } catch { return false; }
  });

  const realRole: AppRole | null = role ?? null;
  const isSuperAdmin = realRole === "super_admin";
  const isStaff = realRole === "super_admin" || realRole === "admin";
  const isAllPropertiesReader = isStaff || realRole === "owner";

  const activePreview = isSuperAdmin && previewingLocationOwner;
  const effectiveRole: AppRole | null = activePreview ? "location_owner" : realRole;
  const isLocationOwner = effectiveRole === "location_owner";

  const togglePreviewLocationOwner = () => {
    setPreviewing((p) => {
      const next = !p;
      try { localStorage.setItem("preview.location_owner", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  // Use Bob's account (already an owner with viewer_property_access rows) as the
  // demo Location Owner. PropertyContext uses this to scope the preview.
  const impersonatedUserId = activePreview ? BOB_USER_ID : null;

  return (
    <PreviewModeContext.Provider
      value={{
        realRole, effectiveRole,
        previewingLocationOwner: activePreview,
        togglePreviewLocationOwner,
        impersonatedUserId,
        isSuperAdmin, isStaff, isAllPropertiesReader, isLocationOwner,
        // legacy aliases
        isOwner: isSuperAdmin,
        impersonateBob: activePreview,
        toggleBob: togglePreviewLocationOwner,
      }}
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