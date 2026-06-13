import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProperties } from "@/contexts/PropertyContext";
import { useDashboard } from "@/contexts/DashboardContext";
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
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReportView } from "@/components/jarvis/report/ReportView";
import { isReportSchema, type ReportSchema } from "@/lib/jarvis/reportSchema";
import jarvisMark from "@/assets/jarvis-mark.png";
import { toast } from "@/hooks/use-toast";

const QUICK_PROMPTS = [
  "Reconcile CTM calls against GHL for the last 14 days",
  "What's the account stability looking like?",
  "Show me a lead performance snapshot",
  "Summarize this property's account health",
];

type ReportRef = { id: string; schema: ReportSchema };

type LatestJarvisContext = {
  propertyId: string | null;
  propertyName: string | null;
  propertySlug: string | null;
  jarvisHeaderProperty: string;
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
    console.log("[Jarvis Auth Debug]", {
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
    console.log("[Jarvis Auth Debug Refresh]", {
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

function extractReports(messages: UIMessage[]): ReportRef[] {
  const reports: ReportRef[] = [];
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (p.type?.startsWith("tool-") || p.type === "dynamic-tool") {
        const tp = p as { type: string; toolName?: string; output?: unknown; state?: string };
        const name = (tp as any).toolName ?? tp.type.replace(/^tool-/, "");
        if (name === "save_visual_report" && tp.state === "output-available") {
          const out = tp.output as { report_id?: string; schema?: unknown } | undefined;
          if (out?.report_id && isReportSchema(out.schema)) {
            reports.push({ id: out.report_id, schema: out.schema });
          }
        }
      }
    }
  }
  return reports;
}

export function JarvisChat() {
  const { session } = useAuth();
  const { activeProperty, properties, setActiveProperty } = useProperties();
  const { range, compareRange, compareMode } = useDashboard();
  const [params, setParams] = useSearchParams();
  const sessionParam = params.get("session");
  const [sessionId, setSessionId] = useState<string | null>(sessionParam);
  const initialQ = params.get("q");
  const urlPropertyId = params.get("propertyId");
  const urlFrom = params.get("from");
  const urlTo = params.get("to");
  const didPrefill = useRef(false);
  const [input, setInput] = useState("");
  const [activeReport, setActiveReport] = useState<ReportRef | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latestContextRef = useRef<LatestJarvisContext | null>(null);

  const iso = useMemo(() => rangeToISO(range), [range]);
  const cmpIso = useMemo(
    () => (compareMode !== "off" && compareRange ? rangeToISO(compareRange) : null),
    [compareMode, compareRange],
  );

  // Hydrate active property from ?propertyId= if present
  useEffect(() => {
    if (!urlPropertyId) return;
    if (activeProperty?.id === urlPropertyId) return;
    const match = properties.find((p) => p.id === urlPropertyId);
    if (match) setActiveProperty(match);
  }, [urlPropertyId, properties, activeProperty?.id, setActiveProperty]);

  const urlProperty = urlPropertyId ? properties.find((p) => p.id === urlPropertyId) ?? null : null;
  const effectiveProperty =
    (urlPropertyId && activeProperty?.id === urlPropertyId ? activeProperty : null) ??
    urlProperty ??
    (!urlPropertyId ? activeProperty : null);
  const effectiveFrom = urlFrom ?? iso.from;
  const effectiveTo = urlTo ?? iso.to;
  const effectivePropertyId = urlPropertyId ?? activeProperty?.id ?? null;

  latestContextRef.current = {
    propertyId: effectivePropertyId,
    propertyName: effectiveProperty?.name ?? null,
    propertySlug: effectiveProperty?.slug ?? null,
    jarvisHeaderProperty: activeProperty?.name ?? (urlPropertyId ? "Loading property..." : "No property"),
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
            context: {
              propertyId: latest?.propertyId ?? null,
              propertyName: latest?.propertyName ?? null,
              propertySlug: latest?.propertySlug ?? null,
              dateRange,
              compareRange: latest?.compareFrom && latest?.compareTo
                ? { from: latest.compareFrom, to: latest.compareTo }
                : null,
              pageContext,
            },
          };
          if (import.meta.env.DEV) {
            console.log("[Jarvis Context Before Send]", {
              selectedPropertyId: latest?.propertyId ?? null,
              selectedPropertyName: latest?.propertyName ?? null,
              selectedPropertySlug: latest?.propertySlug ?? null,
              jarvisHeaderProperty: latest?.jarvisHeaderProperty ?? "No property",
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
            setParams((p) => { const n = new URLSearchParams(p); n.set("session", sid); return n; }, { replace: true });
          }
          return r;
        },
      }),
    [setParams],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: sessionId ?? "new",
    transport,
    onError: (e) => toast({ title: "Jarvis error", description: e.message, variant: "destructive" }),
  });

  // Auto-send prefilled query from Cmd+K — wait for property to hydrate
  useEffect(() => {
    if (initialQ && accessToken && effectivePropertyId && !didPrefill.current) {
      didPrefill.current = true;
      sendMessage({ text: initialQ });
      const next = new URLSearchParams(params);
      next.delete("q");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ, accessToken, effectivePropertyId]);

  const reports = useMemo(() => extractReports(messages), [messages]);
  useEffect(() => {
    if (reports.length && (!activeReport || activeReport.id !== reports[reports.length - 1].id)) {
      setActiveReport(reports[reports.length - 1]);
    }
  }, [reports, activeReport]);

  useEffect(() => { textareaRef.current?.focus(); }, [sessionId, status]);

  const onSubmit = (msg: { text: string }, evt: React.FormEvent) => {
    evt.preventDefault();
    if (!accessToken) return;
    const text = msg.text.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const isLoading = status === "submitted" || status === "streaming";
  const disabled = !accessToken;

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
      title: "Jarvis tool interrupted",
      description:
        "The last tool call didn't finish. Try a smaller window (e.g. last 7 days) and rerun.",
      variant: "destructive",
    });
  }, [isLoading, messages]);

  const saveReport = async (id: string) => {
    const { error: e } = await supabase.from("ai_agent_reports").update({ saved: true }).eq("id", id);
    if (e) throw e;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 h-[calc(100vh-8rem)]">
      {/* Chat pane */}
      <Card className="flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <img src={jarvisMark} alt="Jarvis" width={24} height={24} className="size-6" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold leading-tight">Jarvis</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Powered by GPT-5.5 · {activeProperty?.name ?? "No property"} · {effectiveFrom} → {effectiveTo}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setSessionId(null); setActiveReport(null); setParams({}, { replace: true }); }}>
            New session
          </Button>
        </div>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {!accessToken ? (
              <ConversationEmptyState
                icon={<img src={jarvisMark} alt="" className="size-10 opacity-80" />}
                title="Sign in to use Jarvis"
                description="Jarvis needs an authenticated session to query your account data."
              />
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                icon={<img src={jarvisMark} alt="" className="size-10 opacity-80" />}
                title="Ask Jarvis anything about this account"
                description="Cross-source analytics, reconciliations, account health, and visual reports."
              >
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
              placeholder={disabled ? "Sign in to chat with Jarvis…" : "Ask Jarvis... (e.g. reconcile CTM to GHL for last 14 days)"}
              disabled={disabled}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={disabled || !input.trim() || isLoading} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </Card>

      {/* Report pane */}
      <Card className="flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div className="text-sm font-semibold">Report</div>
          <div className="text-[11px] text-muted-foreground">
            {reports.length ? `${reports.length} generated this session` : "Generated reports will appear here"}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {activeReport ? (
            <ReportView schema={activeReport.schema} reportId={activeReport.id} onSave={saveReport} />
          ) : (
            <div className="h-full grid place-items-center text-center text-sm text-muted-foreground">
              <div>
                <img src={jarvisMark} alt="" className="mx-auto size-12 opacity-50" />
                <div className="mt-3">No report yet. Ask Jarvis for a reconciliation or summary.</div>
              </div>
            </div>
          )}
          {reports.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {reports.map((r) => (
                <Button
                  key={r.id}
                  size="sm"
                  variant={r.id === activeReport?.id ? "default" : "outline"}
                  onClick={() => setActiveReport(r)}
                >
                  {r.schema.title.slice(0, 40)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default JarvisChat;