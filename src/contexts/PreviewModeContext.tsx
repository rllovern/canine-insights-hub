import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { AppRole } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { BOB_USER_ID } from "@/lib/owners";

const PREVIEW_STORAGE_KEY = "preview.role";
const VALID_PREVIEW_ROLES: AppRole[] = ["super_admin", "admin", "owner", "location_owner"];

interface PreviewModeContextValue {
  /** The role actually granted by the database. */
  realRole: AppRole | null;
  /** Role currently being previewed in the UI. Differs from realRole only when a Super Admin picks a preview role. */
  effectiveRole: AppRole | null;
  /** The preview role selected by Super Admin (equal to realRole when not previewing). */
  previewRole: AppRole | null;
  /** Set the preview role. No-op unless the signed-in account is a Super Admin. */
  setPreviewRole: (role: AppRole) => void;
  /** True when the Super Admin is previewing any non–super-admin role. */
  isPreviewing: boolean;
  /** @deprecated retained for legacy consumers — true when previewing as Location Owner. */
  previewingLocationOwner: boolean;
  /** @deprecated legacy toggle — now flips between super_admin and location_owner. */
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
  const [storedPreviewRole, setStoredPreviewRole] = useState<AppRole | null>(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
      if (raw && (VALID_PREVIEW_ROLES as string[]).includes(raw)) return raw as AppRole;
      // migrate legacy toggle key
      if (localStorage.getItem("preview.location_owner") === "1") return "location_owner";
    } catch {}
    return null;
  });

  const realRole: AppRole | null = role ?? null;
  const realIsSuperAdmin = realRole === "super_admin";

  // Only Super Admin can actually preview a different role.
  const previewRole: AppRole | null = realIsSuperAdmin && storedPreviewRole ? storedPreviewRole : realRole;
  const effectiveRole: AppRole | null = previewRole;
  const isPreviewing = realIsSuperAdmin && !!storedPreviewRole && storedPreviewRole !== "super_admin";

  const isSuperAdmin = effectiveRole === "super_admin";
  const isStaff = effectiveRole === "super_admin" || effectiveRole === "admin";
  const isAllPropertiesReader = isStaff || effectiveRole === "owner";
  const isLocationOwner = effectiveRole === "location_owner";

  const setPreviewRole = (next: AppRole) => {
    if (!realIsSuperAdmin) return;
    const clean: AppRole | null = next === "super_admin" ? null : next;
    setStoredPreviewRole(clean);
    try {
      if (clean) localStorage.setItem(PREVIEW_STORAGE_KEY, clean);
      else localStorage.removeItem(PREVIEW_STORAGE_KEY);
      // clear legacy key
      localStorage.removeItem("preview.location_owner");
    } catch {}
  };

  const previewingLocationOwner = isPreviewing && effectiveRole === "location_owner";
  const togglePreviewLocationOwner = () => {
    setPreviewRole(previewingLocationOwner ? "super_admin" : "location_owner");
  };

  // Use Bob's account as the demo Location Owner so property scoping works.
  // Admin/Owner previews still show every property, so no impersonation needed.
  const impersonatedUserId = previewingLocationOwner ? BOB_USER_ID : null;

  return (
    <PreviewModeContext.Provider
      value={{
        realRole, effectiveRole,
        previewRole,
        setPreviewRole,
        isPreviewing,
        previewingLocationOwner,
        togglePreviewLocationOwner,
        impersonatedUserId,
        isSuperAdmin, isStaff, isAllPropertiesReader, isLocationOwner,
        // legacy aliases
        isOwner: isSuperAdmin,
        impersonateBob: previewingLocationOwner,
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