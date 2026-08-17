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
  Conversation, ConversationContent, ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
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

// Plain-English label for whatever lookup Bob is running right now.
const TOOL_ACTIVITY: Record<string, string> = {
  list_locations: "Checking which locations you can see…",
  get_property_context: "Checking your location setup…",
  get_portfolio_trend: "Rolling up all your locations…",
  get_trend_windows: "Comparing this period to before…",
  get_source_health: "Checking your data feeds…",
  get_call_summary: "Reading through your calls…",
  get_lead_quality: "Sorting your leads by quality…",
  get_ad_performance: "Looking at your ad spend…",
  get_budget_pacing: "Checking your budget pacing…",
  get_sales_summary: "Pulling your sales from the CRM…",
};

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

type BobChatProps = {
  mood?: BobMood;
  setMood?: (m: BobMood, hold?: number) => void;
  onThinkingChange?: (v: boolean) => void;
  onClose?: () => void;
};

export function BobChat({ mood = "soft", setMood, onThinkingChange, onClose }: BobChatProps) {
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

  const { messages, sendMessage, status, error, setMessages, regenerate } = useChat({
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

  const submit = () => {
    if (!accessToken) return;
    const text = input.trim();
    if (!text || status === "submitted" || status === "streaming") return;
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

  // Keep Bob's face in sync with what the chat is doing.
  useEffect(() => { onThinkingChange?.(isLoading); }, [isLoading, onThinkingChange]);
  useEffect(() => {
    if (!setMood) return;
    if (isLoading) setMood("thinking", 0);
  }, [isLoading, setMood]);

  const lastAssistantId = useRef<string | null>(null);
  useEffect(() => {
    if (!setMood || isLoading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.id === lastAssistantId.current) return;
    lastAssistantId.current = last.id;
    const text = (last.parts ?? [])
      .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
      .join(" ")
      .toLowerCase();
    const worrying = /(problem|drop|down|broken|stale|alert the admin|concern|issue|paused|failed)/.test(text);
    setMood(worrying ? "concerned" : Math.random() < 0.5 ? "happy" : "curious", 5000);
  }, [messages, isLoading, setMood]);

  useEffect(() => { if (error && setMood) setMood("concerned", 5000); }, [error, setMood]);

  // The user only wants a "thinking" state — no per-tool activity chatter.
  const activity = isLoading ? BOB_STATUS.thinking : null;

  // A turn that ended with no text at all (worker recycled mid-run) must not
  // look like Bob simply ignored the question.
  const lastMessage = messages[messages.length - 1];
  const droppedAnswer =
    !isLoading && !error && !!lastMessage && lastMessage.role === "assistant" &&
    !(lastMessage.parts ?? []).some((p) => p.type === "text" && (p as { text?: string }).text?.trim());

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — leaves room for Bob peeking over the corner */}
      <div className="flex items-start justify-between gap-2 border-b border-border/60 py-3 pl-[104px] pr-3">
        <div className="min-w-0">
          <div className="text-base font-bold leading-tight">Bob</div>
          <div className="truncate text-xs text-muted-foreground">
            {isLoading ? (activity ?? BOB_STATUS.thinking) : BOB_STATUS[mood]}
          </div>
          <div className="truncate text-[10px] text-muted-foreground/80">
            {scopeLabel} · {effectiveFrom} → {effectiveTo}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button size="icon" variant="ghost" className="size-7 rounded-full" aria-label="Recent sessions">
                <History className="size-3.5" />
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
                      onClick={() => setSessionId(s.id)}
                      className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted/60 ${
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
          <Button
            size="icon"
            variant="ghost"
            className="size-7 rounded-full"
            aria-label="New conversation"
            onClick={() => { setSessionId(null); setMessages([]); }}
          >
            <Plus className="size-3.5" />
          </Button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-7 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/70"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Transcript */}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="flex flex-col gap-2 p-3.5">
          {!accessToken ? (
            <BobBubble>Sign in and I'll take a look at your account for you.</BobBubble>
          ) : noAccessibleProperties ? (
            <BobBubble>
              Your account doesn't have access to any locations yet — ask an admin to grant access and I'll dig in.
            </BobBubble>
          ) : (
            <>
              {messages.length === 0 && <BobBubble>{GREETING}</BobBubble>}
              {messages.map((m) => {
                const textParts = (m.parts ?? []).filter(
                  (p) => p.type === "text" && (p as { text?: string }).text?.trim(),
                );
                // Tool calls are internal plumbing — never shown.
                if (textParts.length === 0) return null;
                return (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  style={{ animation: "msgIn .25s ease" }}
                >
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[85%] rounded-[18px] rounded-br-[4px] px-3.5 py-2.5 text-sm"
                        : "max-w-[92%] rounded-[18px] rounded-bl-[4px] bg-muted px-3.5 py-2.5 text-sm text-foreground"
                    }
                    style={
                      m.role === "user"
                        ? { background: "hsl(var(--bob-bubble))", color: "hsl(var(--bob-bubble-foreground))" }
                        : undefined
                    }
                  >
                    {textParts.map((part, i) => (
                      <MessageResponse key={i}>{(part as { text: string }).text}</MessageResponse>
                    ))}
                  </div>
                </div>
                );
              })}
              {droppedAnswer && (
                <div className="flex justify-start">
                  <div className="max-w-[92%] rounded-[18px] rounded-bl-[4px] bg-muted px-3.5 py-2.5 text-sm">
                    That one got cut off before I could answer.{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => regenerate()}
                    >
                      Tap to try again
                    </button>
                  </div>
                </div>
              )}
              {isLoading && (
                <div className="flex justify-start">
                  <div
                    className="flex gap-1 rounded-[18px] rounded-bl-[4px] bg-muted px-3.5 py-3"
                    style={{ animation: "msgIn .25s ease" }}
                  >
                    <span className="size-[7px] rounded-full bg-muted-foreground" style={{ animation: "dotPulse 1.2s infinite" }} />
                    <span className="size-[7px] rounded-full bg-muted-foreground" style={{ animation: "dotPulse 1.2s .18s infinite" }} />
                    <span className="size-[7px] rounded-full bg-muted-foreground" style={{ animation: "dotPulse 1.2s .36s infinite" }} />
                  </div>
                </div>
              )}
              {error && (
                <div className="text-xs text-destructive">Error: {error.message}</div>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Quick chips */}
      <div className="flex flex-wrap gap-2 px-3.5 pb-1.5 pt-2.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled || isLoading}
            onClick={() => sendMessage({ text: p })}
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
            style={{ background: "hsl(var(--bob-bubble) / 0.1)", color: "hsl(var(--bob-bubble))" }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 px-3.5 pb-3.5 pt-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={disabled ? "Sign in to chat with Bob…" : "Ask about your numbers…"}
          disabled={disabled}
          className="flex-1 resize-none rounded-[999px] border border-input bg-background px-4 py-2.5 text-sm outline-none transition focus:border-ring disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          aria-label="Send"
          disabled={disabled || !input.trim() || isLoading}
          className="grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground transition hover:brightness-110 disabled:opacity-40"
          style={{ background: "hsl(var(--bob-bubble))", color: "hsl(var(--bob-bubble-foreground))" }}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BobBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start" style={{ animation: "msgIn .25s ease" }}>
      <div className="max-w-[92%] rounded-[18px] rounded-bl-[4px] bg-muted px-3.5 py-2.5 text-sm text-foreground">
        {children}
      </div>
    </div>
  );
}

export default BobChat;
