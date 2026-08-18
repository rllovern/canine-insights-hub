import { createContext, useCallback, useContext, useMemo, useState } from "react";

type PendingPrompt = { text: string; nonce: number } | null;
type RestoreRequest = { id: string; nonce: number } | null;

type BobContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  openBob: (prompt?: string) => void;
  openBobSession: (sessionId: string) => void;
  closeBob: () => void;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  pending: PendingPrompt;
  clearPending: () => void;
  restore: RestoreRequest;
  clearRestore: () => void;
};

const Ctx = createContext<BobContextValue | null>(null);

export function BobProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPrompt>(null);
  const [restore, setRestore] = useState<RestoreRequest>(null);

  const openBob = useCallback((prompt?: string) => {
    if (prompt?.trim()) setPending({ text: prompt.trim(), nonce: Date.now() });
    setOpen(true);
  }, []);

  const openBobSession = useCallback((id: string) => {
    setRestore({ id, nonce: Date.now() });
    setOpen(true);
  }, []);

  const closeBob = useCallback(() => setOpen(false), []);
  const clearPending = useCallback(() => setPending(null), []);
  const clearRestore = useCallback(() => setRestore(null), []);

  const value = useMemo(
    () => ({ open, setOpen, openBob, openBobSession, closeBob, sessionId, setSessionId, pending, clearPending, restore, clearRestore }),
    [open, openBob, openBobSession, closeBob, sessionId, pending, clearPending, restore, clearRestore],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBob() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBob must be used inside BobProvider");
  return v;
}
