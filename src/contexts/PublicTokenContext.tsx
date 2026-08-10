import { createContext, useContext, type ReactNode } from "react";

/**
 * Set only inside the tokenized client report (/report/:token). When present,
 * data hooks must use the `*_by_report_token` RPCs instead of direct table
 * reads, because the visitor is anonymous and RLS returns nothing.
 */
const PublicTokenCtx = createContext<string | null>(null);

export function PublicTokenProvider({ token, children }: { token: string | null; children: ReactNode }) {
  return <PublicTokenCtx.Provider value={token}>{children}</PublicTokenCtx.Provider>;
}

/** Returns the report token when rendering a public report, else null. */
export function usePublicToken(): string | null {
  return useContext(PublicTokenCtx);
}
