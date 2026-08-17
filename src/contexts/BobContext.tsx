import { createContext, useCallback, useContext, useMemo, useState } from "react";

type PendingPrompt = { text: string; nonce: number } | null;

type BobContextValue = {
  open: boolean;
  setOpen: (v: boolean) => void;
  openBob: (prompt?: string) => void;
  closeBob: () => void;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  pending: PendingPrompt;
  clearPending: () => void;
};

const Ctx = createContext<BobContextValue | null>(null);

export function BobProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPrompt>(null);

  const openBob = useCallback((prompt?: string) => {
    if (prompt?.trim()) setPending({ text: prompt.trim(), nonce: Date.now() });
    setOpen(true);
  }, []);

  const closeBob = useCallback(() => setOpen(false), []);
  const clearPending = useCallback(() => setPending(null), []);

  const value = useMemo(
    () => ({ open, setOpen, openBob, closeBob, sessionId, setSessionId, pending, clearPending }),
    [open, openBob, closeBob, sessionId, pending, clearPending],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBob() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBob must be used inside BobProvider");
  return v;
}
