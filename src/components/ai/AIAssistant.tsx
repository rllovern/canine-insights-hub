import { useState, useRef, useEffect, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles, X, Loader2, Send, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { rangeToISO } from "@/lib/metrics";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Msg { role: "user" | "assistant"; content: string; }

const SUGGESTIONS = [
  "How are we doing this month vs last?",
  "Compare ad sources",
  "Year over year trend",
  "Cost per intake direction",
];

interface AIAssistantProps {
  /** When true, force role="client" for the AI context regardless of auth role.
   *  Used on the public report so SPAM / Bad Lead never leak. */
  forceViewerRole?: boolean;
  /** When provided, fetch context via the public token RPC instead of the
   *  authenticated one. Used by PublicReport. */
  publicToken?: string;
}

const markdownComponents = {
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="my-2 w-full overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-xs sm:text-sm" {...props} />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => (
    <th className="border-b border-border px-2 py-1.5 text-left align-top font-semibold whitespace-nowrap" {...props} />
  ),
  td: (props: ComponentPropsWithoutRef<"td">) => (
    <td className="border-b border-border/60 px-2 py-1.5 align-top whitespace-normal break-words" {...props} />
  ),
};

export function AIAssistant({ forceViewerRole = false, publicToken }: AIAssistantProps = {}) {
  const { effectiveRole: authRole, activeProperty } = useAuth();
  const role = forceViewerRole ? "client" : authRole;
  const { range } = useDashboard();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }); }, [messages, busy]);

  const fetchContext = async () => {
    const { from, to } = rangeToISO(range);
    let payload: any = null;
    if (publicToken) {
      const { data, error } = await supabase.rpc("public_ai_assistant_context", {
        _token: publicToken, _from: from, _to: to,
      });
      if (error) throw error;
      payload = data;
    } else if (activeProperty?.id) {
      const { data, error } = await supabase.rpc("ai_assistant_context", {
        _client_id: activeProperty.id, _from: from, _to: to,
      });
      if (error) throw error;
      payload = data;
    }
    return {
      client: activeProperty?.name,
      role,
      ...(payload ?? {}),
    };
  };

  const send = async (q?: string) => {
    const text = (q ?? input).trim();
    if (!text || busy) return;
    setInput("");
    const next = [...messages, { role: "user", content: text } as Msg];
    setMessages(next);
    setBusy(true);
    try {
      const context = await fetchContext();
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: next, context },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "(no answer)" }]);
    } catch (e: any) {
      const msg = e?.message?.includes("429") ? "Rate limit hit, try again in a moment."
        : e?.message?.includes("402") ? "AI credits exhausted. Add funds in Settings → Workspace → Usage."
        : e?.message ?? "Something went wrong.";
      toast({ title: "Assistant error", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 sm:bottom-6 sm:right-6 z-40 h-12 px-4 rounded-full bg-gradient-brand text-white shadow-lg flex items-center gap-2 hover:scale-[1.03] transition-transform">
          <Sparkles className="size-4" />
          <span className="text-sm font-semibold">Ask AI</span>
        </button>
      )}

      {/* Drawer */}
      <div className={cn(
        "fixed top-0 right-0 bottom-0 w-full sm:w-[420px] bg-card border-l border-border shadow-lg z-50 transform transition-transform duration-300 flex flex-col",
        "pt-[env(safe-area-inset-top)] sm:pt-0",
        open ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="h-16 shrink-0 px-5 flex items-center justify-between border-b">
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-gradient-brand grid place-items-center"><Sparkles className="size-4 text-white" /></div>
            <div>
              <div className="text-sm font-semibold tracking-tight">AI Assistant</div>
              <div className="text-[11px] text-muted-foreground">Scoped to {activeProperty?.name ?? "current"} · {role}</div>
            </div>
          </div>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(false)}><X className="size-4" /></Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="mx-auto size-12 rounded-2xl bg-primary-muted text-primary grid place-items-center mb-3">
                <MessageSquareText className="size-5" />
              </div>
              <div className="text-sm font-semibold">Ask anything about your data</div>
              <div className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                I can compare months, sources, and trends — including periods outside the current view.
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="px-2.5 py-1 rounded-full text-[11px] bg-secondary hover:bg-accent transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex w-full min-w-0", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn(
                "min-w-0 px-3.5 py-2.5 rounded-2xl text-[13px] sm:text-sm leading-relaxed overflow-hidden",
                m.role === "user"
                  ? "max-w-[88%] sm:max-w-[85%] bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap break-words"
                  : "w-full sm:w-auto sm:max-w-[85%] bg-muted text-foreground rounded-bl-sm prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-strong:font-semibold prose-strong:text-foreground break-words [&_pre]:overflow-x-auto [&_code]:break-words"
              )}>
                {m.role === "assistant"
                  ? <ReactMarkdown components={markdownComponents}>{m.content}</ReactMarkdown>
                  : m.content}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="bg-muted px-3.5 py-2.5 rounded-2xl rounded-bl-sm">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] flex gap-2 bg-card">
          <Input value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about leads, cost, sources…"
            onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
          <Button onClick={() => send()} disabled={busy || !input.trim()} size="icon"><Send className="size-4" /></Button>
        </div>
      </div>
    </>
  );
}
