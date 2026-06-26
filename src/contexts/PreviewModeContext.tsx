import { createContext, useContext, useMemo, useState, ReactNode } from "react";
import { AppRole } from "@/lib/types";
import { useAuth } from "./AuthContext";
import { isOwnerEmail, BOB_USER_ID } from "@/lib/owners";

interface PreviewModeContextValue {
  /** The role actually granted by the database. */
  realRole: AppRole | null;
  /** The role currently being previewed in the UI. Differs from realRole only when the owner is impersonating Bob. */
  effectiveRole: AppRole | null;
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
    return realRole;
  }, [realRole, isOwner, impersonateBob]);

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
        realRole, effectiveRole,
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