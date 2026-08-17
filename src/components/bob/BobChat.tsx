import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProperties } from "@/contexts/PropertyContext";
import { useScope } from "@/contexts/ScopeContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { useBob } from "@/contexts/BobContext";
import { rangeToISO } from "@/lib/metrics";
import {
  Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message, MessageContent, MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Tool, ToolHeader, ToolContent, ToolInput, ToolOutput,
} from "@/components/ai-elements/tool";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { History, Plus, X, ArrowUp } from "lucide-react";
import { BOB_STATUS, type BobMood } from "./BobFace";
import { toast } from "@/hooks/use-toast";

const QUICK_PROMPTS = [
  "Why are my leads down?",
  "Is my ad spend working?",
  "How am I doing vs last year?",
  "What do these numbers mean?",
];

const GREETING =
  "Hi, I'm Bob! I keep an eye on your ads, calls, leads and sales — and I explain them in plain English. Ask me anything, or tap a question below.";

type LatestBobContext = {
  propertyId: string | null;
  propertyName: string | null;
  propertySlug: string | null;
  scopeMode: "agency" | "property";
  propertyIds: string[] | null;
  scopeLabel: string;
  from: string;
  to: string;
  compareFrom: string | null;
  compareTo: string | null;
  sessionId: string | null;
};

async function getFreshAccessToken() {
  const { data: sessionData, error } = await supabase.auth.getSession();
  if (import.meta.env.DEV) {
    const session = sessionData.session;
    console.log("[Bob Auth Debug]", {
      hasSession: !!session,
      hasAccessToken: !!session?.access_token,
      tokenPrefix: session?.access_token?.slice(0, 12),
      expiresAt: session?.expires_at,
      expiresInSeconds: session?.expires_at
        ? session.expires_at - Math.floor(Date.now() / 1000)
        : null,
      userId: session?.user?.id,
      error,
    });
  }
  if (error || !sessionData.session?.access_token) return null;

  const expiresAt = sessionData.session.expires_at ?? 0;
  const needsRefresh = expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 60;
  if (!needsRefresh) return sessionData.session.access_token;

  const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
  if (import.meta.env.DEV) {
    const session = refreshData.session;
    console.log("[Bob Auth Debug Refresh]", {
      hasSession: !!session,
      hasAccessToken: !!session?.access_token,
      tokenPrefix: session?.access_token?.slice(0, 12),
      expiresAt: session?.expires_at,
      expiresInSeconds: session?.expires_at
        ? session.expires_at - Math.floor(Date.now() / 1000)
        : null,
      userId: session?.user?.id,
      error: refreshError,
    });
  }
  if (refreshError || !refreshData.session?.access_token) return null;
  return refreshData.session.access_token;
}

export function BobChat() {
  const { session } = useAuth();
  const { properties } = useProperties();
  // The sidebar location selector (ScopeContext) is the single source of truth
  // for what Bob is allowed to look at.
  const { mode, propertyId: scopedPropertyId, propertyIds, activeProperty, label: scopeLabel } = useScope();
  const { range, compareRange, compareMode } = useDashboard();
  const { sessionId, setSessionId, pending, clearPending, open: drawerOpen } = useBob();
  const [input, setInput] = useState("");
  const [recentSessions, setRecentSessions] = useState<
    { id: string; title: string | null; updated_at: string }[]
  >([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestContextRef = useRef<LatestBobContext | null>(null);

  const iso = useMemo(() => rangeToISO(range), [range]);
  const cmpIso = useMemo(
    () => (compareMode !== "off" && compareRange ? rangeToISO(compareRange) : null),
    [compareMode, compareRange],
  );

  const effectiveProperty = activeProperty;
  const effectiveFrom = iso.from;
  const effectiveTo = iso.to;
  const effectivePropertyId = mode === "property" ? scopedPropertyId : null;

  latestContextRef.current = {
    propertyId: effectivePropertyId,
    propertyName: effectiveProperty?.name ?? null,
    propertySlug: effectiveProperty?.slug ?? null,
    scopeMode: mode,
    propertyIds: propertyIds,
    scopeLabel,
    from: effectiveFrom,
    to: effectiveTo,
    compareFrom: cmpIso?.from ?? null,
    compareTo: cmpIso?.to ?? null,
    sessionId,
  };

  const accessToken = session?.access_token ?? null;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis`,
        prepareSendMessagesRequest: ({ messages, id, api }) => {
          const latest = latestContextRef.current;
          const dateRange = { from: latest?.from ?? null, to: latest?.to ?? null };
          const pageContext = {
            route: window.location.pathname,
            search: window.location.search,
          };
          const payload = {
            id,
            messages,
            propertyId: latest?.propertyId ?? null,
            propertyName: latest?.propertyName ?? null,
            propertySlug: latest?.propertySlug ?? null,
            dateRange,
            from: latest?.from ?? null,
            to: latest?.to ?? null,
            compareFrom: latest?.compareFrom ?? null,
            compareTo: latest?.compareTo ?? null,
            sessionId: latest?.sessionId ?? null,
            pageContext,
            scope: {
              mode: latest?.scopeMode ?? "agency",
              propertyId: latest?.propertyId ?? null,
              propertyIds: latest?.propertyIds ?? null,
              label: latest?.scopeLabel ?? null,
            },
            context: {
              propertyId: latest?.propertyId ?? null,
              propertyName: latest?.propertyName ?? null,
              propertySlug: latest?.propertySlug ?? null,
              scopeMode: latest?.scopeMode ?? "agency",
              scopeLabel: latest?.scopeLabel ?? null,
              dateRange,
              compareRange: latest?.compareFrom && latest?.compareTo
                ? { from: latest.compareFrom, to: latest.compareTo }
                : null,
              pageContext,
            },
          };
          if (import.meta.env.DEV) {
            console.log("[Bob Context Before Send]", {
              selectedPropertyId: latest?.propertyId ?? null,
              selectedPropertyName: latest?.propertyName ?? null,
              selectedPropertySlug: latest?.propertySlug ?? null,
              scopeLabel: latest?.scopeLabel ?? null,
              scopeMode: latest?.scopeMode ?? "agency",
              dateRange,
              requestBodyPropertyId: payload?.propertyId,
              requestBodyContext: payload?.context,
            });
          }
          return {
            api,
            body: payload,
          };
        },
        fetch: async (url, init) => {
          const freshToken = await getFreshAccessToken();
          if (!freshToken) {
            throw new Error("Please sign in again.");
          }
          const headers = new Headers(init?.headers ?? {});
          headers.set("Authorization", `Bearer ${freshToken}`);
          headers.set("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
          headers.set("Content-Type", "application/json");
          const r = await fetch(url as RequestInfo, { ...init, headers });
          const sid = r.headers.get("x-session-id");
          if (sid && sid !== latestContextRef.current?.sessionId) {
            setSessionId(sid);
          }
          return r;
        },
      }),
    [setSessionId],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    id: sessionId ?? "new",
    transport,
    onError: (e) => toast({ title: "Bob hit a problem", description: e.message, variant: "destructive" }),
  });

  // Restore message history when loading an existing session
  const restoredForSession = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !accessToken) return;
    if (restoredForSession.current === sessionId) return;
    if (messages.length > 0) {
      restoredForSession.current = sessionId;
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase
        .from("ai_agent_messages")
        .select("id,role,content,parts_json,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (cancelled || e || !data || data.length === 0) return;
      const restored: UIMessage[] = data.map((row) => {
        const parts = Array.isArray(row.parts_json) && row.parts_json.length > 0
          ? (row.parts_json as UIMessage["parts"])
          : [{ type: "text", text: row.content ?? "" }] as UIMessage["parts"];
        return {
          id: row.id,
          role: (row.role === "assistant" ? "assistant" : "user") as UIMessage["role"],
          parts,
        };
      });
      restoredForSession.current = sessionId;
      setMessages(restored);
    })();
    return () => { cancelled = true; };
  }, [sessionId, accessToken, messages.length, setMessages]);

  // Auto-send a prompt handed in by "Ask Bob" buttons / the command bar.
  const sentNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!pending || !accessToken) return;
    if (sentNonce.current === pending.nonce) return;
    sentNonce.current = pending.nonce;
    sendMessage({ text: pending.text });
    clearPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, accessToken]);

  // Load recent sessions for the dropdown
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("ai_agent_sessions")
        .select("id,title,updated_at")
        .order("updated_at", { ascending: false })
        .limit(15);
      if (!cancelled && data) setRecentSessions(data);
    })();
  }, [accessToken, sessionId]);

  useEffect(() => {
    if (!drawerOpen) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [sessionId, status, drawerOpen]);

  const onSubmit = (msg: { text: string }, evt: React.FormEvent) => {
    evt.preventDefault();
    if (!accessToken) return;
    const text = msg.text.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const isLoading = status === "submitted" || status === "streaming";
  const noAccessibleProperties =
    !!accessToken && properties.length === 0;
  const disabled = !accessToken || noAccessibleProperties;

  // If the stream ends (status flips out of streaming) with a tool part still
  // stuck in input-streaming/input-available, the worker was likely killed
  // mid-execution (e.g. edge CPU budget). Surface this instead of leaving the
  // badge stuck on "Pending".
  const interruptedNoticeShown = useRef<string | null>(null);
  useEffect(() => {
    if (isLoading) return;
    if (!messages.length) return;
    const last = messages[messages.length - 1];
    const stuck = (last.parts ?? []).find((p) => {
      const t = (p as { type?: string }).type ?? "";
      const s = (p as { state?: string }).state ?? "";
      return (t.startsWith("tool-") || t === "dynamic-tool") &&
        (s === "input-streaming" || s === "input-available");
    });
    if (!stuck) return;
    const key = `${last.id}:${(stuck as { type?: string }).type}`;
    if (interruptedNoticeShown.current === key) return;
    interruptedNoticeShown.current = key;
    const stuckAny = stuck as { state?: string; output?: unknown; errorText?: string };
    stuckAny.state = "output-error";
    stuckAny.errorText =
      "Tool run was interrupted (likely exceeded compute budget). Try a narrower window (e.g. days: 7) or rerun.";
    toast({
      title: "Bob's lookup was interrupted",
      description:
        "The last tool call didn't finish. Try a smaller window (e.g. last 7 days) and rerun.",
      variant: "destructive",
    });
  }, [isLoading, messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 pr-12 border-b">
          <img src={bobMark} alt="Bob" width={24} height={24} className="size-6" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">Bob</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Your marketing analyst · {scopeLabel} · {effectiveFrom} → {effectiveTo}
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="gap-1.5">
                <History className="size-3.5" />
                Recent
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1">
              {recentSessions.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">No sessions yet.</div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {recentSessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSessionId(s.id);
                      }}
                      className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted/60 ${
                        s.id === sessionId ? "bg-muted/60" : ""
                      }`}
                    >
                      <div className="truncate font-medium">{s.title || "Untitled session"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(s.updated_at).toLocaleString()}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
          <Button size="sm" variant="ghost" onClick={() => { setSessionId(null); }}>
            New
          </Button>
        </div>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {!accessToken ? (
              <ConversationEmptyState
                icon={<img src={bobMark} alt="" className="size-10 opacity-80" />}
                title="Sign in to talk to Bob"
                description="Bob needs you signed in before he can look at your account."
              />
            ) : noAccessibleProperties ? (
              <ConversationEmptyState
                icon={<img src={bobMark} alt="" className="size-10 opacity-80" />}
                title="No properties available"
                description="Your account doesn't have access to any properties yet. Ask an admin to grant access."
              />
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                icon={<img src={bobMark} alt="" className="size-10 opacity-80" />}
                title="Hi, I'm Bob — ask me anything about your marketing"
                description="I look at your ads, calls, leads and sales, and explain what they actually mean in plain English."
              >
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">Hi, I'm Bob — your marketing analyst</h3>
                  <p className="text-muted-foreground text-sm">
                    I look at your ads, calls, leads and sales, and explain what they actually mean in plain English.
                  </p>
                </div>
                <div className="mt-4 grid gap-2 w-full max-w-md">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      disabled={disabled}
                      onClick={() => sendMessage({ text: p })}
                      className="text-left text-sm border rounded-md px-3 py-2 hover:bg-muted/50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </ConversationEmptyState>
            ) : (
              messages.map((m) => (
                <Message key={m.id} from={m.role}>
                  <MessageContent>
                    {m.parts.map((part, i) => {
                      if (part.type === "text") {
                        return <MessageResponse key={i}>{part.text}</MessageResponse>;
                      }
                      if (part.type?.startsWith("tool-") || part.type === "dynamic-tool") {
                        const tp = part as any;
                        const name = tp.toolName ?? tp.type.replace(/^tool-/, "");
                        return (
                          <Tool key={i} defaultOpen={false}>
                            <ToolHeader
                              type={tp.type === "dynamic-tool" ? "dynamic-tool" : (tp.type as any)}
                              state={tp.state}
                              toolName={tp.type === "dynamic-tool" ? name : undefined as any}
                              title={name}
                            />
                            <ToolContent>
                              <ToolInput input={tp.input} />
                              <ToolOutput output={tp.output} errorText={tp.errorText} />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })}
                  </MessageContent>
                </Message>
              ))
            )}
            {isLoading && (
              <div className="px-1"><Shimmer>Thinking...</Shimmer></div>
            )}
            {error && (
              <div className="text-xs text-destructive">Error: {error.message}</div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t p-3">
          <PromptInput onSubmit={onSubmit}>
            <PromptInputTextarea
              ref={textareaRef as any}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={disabled ? "Sign in to chat with Bob…" : "Ask Bob anything… (e.g. why did my calls drop last week?)"}
              disabled={disabled}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={disabled || !input.trim() || isLoading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

export default BobChat;