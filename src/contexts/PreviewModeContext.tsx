import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { AppRole } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { isOwnerEmail, BOB_USER_ID } from "@/lib/owners";

interface PreviewModeContextValue {
  /** The role actually granted by the database. */
  realRole: AppRole | null;
  /** The role currently being previewed in the UI (only differs from realRole when an internal user previews as viewer). */
  effectiveRole: AppRole | null;
  isPreviewing: boolean;
  togglePreview: () => void;
  setPreviewing: (v: boolean) => void;
  /** True when the owner is impersonating Bob (the demo viewer). */
  impersonateBob: boolean;
  toggleBob: () => void;
  /** Set to Bob's auth.users id when impersonateBob is active for an owner, otherwise null. */
  impersonatedUserId: string | null;
  /** True when the signed-in account is on the owner allowlist. */
  isOwner: boolean;
}

export const PreviewModeContext = createContext<PreviewModeContextValue | undefined>(undefined);

export function PreviewModeProvider({ children }: { children: ReactNode }) {
  const { role, user } = useAuth();
  const [previewing, setPreviewing] = useState(false);
  const [impersonateBob, setImpersonateBob] = useState<boolean>(() => {
    try { return localStorage.getItem("preview.bob") === "1"; } catch { return false; }
  });

  const isOwner = isOwnerEmail(user?.email);

  const realRole: AppRole | null = useMemo(() => {
    if (role === "internal") return "internal";
    if (role === "viewer") return "viewer";
    return role ?? null;
  }, [role]);

  const effectiveRole: AppRole | null = useMemo(() => {
    if (isOwner && impersonateBob) return "viewer";
    if (realRole === "internal" && previewing) return "viewer";
    return realRole;
  }, [realRole, previewing, isOwner, impersonateBob]);

  const togglePreview = () => setPreviewing((p) => !p);
  const toggleBob = () => {
    setImpersonateBob((p) => {
      const next = !p;
      try { localStorage.setItem("preview.bob", next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const impersonatedUserId = isOwner && impersonateBob ? BOB_USER_ID : null;

  return (
    <PreviewModeContext.Provider
      value={{
        realRole, effectiveRole, isPreviewing: previewing, togglePreview, setPreviewing,
        impersonateBob: isOwner && impersonateBob, toggleBob, impersonatedUserId, isOwner,
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