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
  const { activeProperty } = useProperties();
  const { range } = useDashboard();
  const [params, setParams] = useSearchParams();
  const sessionParam = params.get("session");
  const [sessionId, setSessionId] = useState<string | null>(sessionParam);
  const [input, setInput] = useState("");
  const [activeReport, setActiveReport] = useState<ReportRef | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const iso = useMemo(() => rangeToISO(range), [range]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/jarvis`,
        headers: () => ({
          Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        }),
        body: () => ({
          propertyId: activeProperty?.id ?? null,
          from: iso.from,
          to: iso.to,
          sessionId,
        }),
        fetch: async (url, init) => {
          const r = await fetch(url as RequestInfo, init);
          const sid = r.headers.get("x-session-id");
          if (sid && sid !== sessionId) {
            setSessionId(sid);
            setParams((p) => { const n = new URLSearchParams(p); n.set("session", sid); return n; }, { replace: true });
          }
          return r;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.access_token, activeProperty?.id, iso.from, iso.to, sessionId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: sessionId ?? "new",
    transport,
    onError: (e) => toast({ title: "Jarvis error", description: e.message, variant: "destructive" }),
  });

  const reports = useMemo(() => extractReports(messages), [messages]);
  useEffect(() => {
    if (reports.length && (!activeReport || activeReport.id !== reports[reports.length - 1].id)) {
      setActiveReport(reports[reports.length - 1]);
    }
  }, [reports, activeReport]);

  useEffect(() => { textareaRef.current?.focus(); }, [sessionId, status]);

  const onSubmit = (msg: { text: string }, evt: React.FormEvent) => {
    evt.preventDefault();
    const text = msg.text.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  const isLoading = status === "submitted" || status === "streaming";

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
              {activeProperty?.name ?? "No property"} · {iso.from} → {iso.to}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { setSessionId(null); setActiveReport(null); setParams({}, { replace: true }); }}>
            New session
          </Button>
        </div>

        <Conversation className="flex-1 min-h-0">
          <ConversationContent>
            {messages.length === 0 ? (
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
                      onClick={() => sendMessage({ text: p })}
                      className="text-left text-sm border rounded-md px-3 py-2 hover:bg-muted/50 transition"
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
              placeholder="Ask Jarvis... (e.g. reconcile CTM to GHL for last 14 days)"
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!input.trim() || isLoading} />
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