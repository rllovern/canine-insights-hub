import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { EmptyState } from "@/components/data/EmptyState";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ChevronDown, MessageSquare } from "lucide-react";

interface SessionRow {
  id: string;
  user_id: string;
  property_id: string | null;
  title: string | null;
  page_context: string | null;
  date_range_start: string | null;
  date_range_end: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  created_at: string;
}

interface AuthUser {
  id: string;
  email: string | null;
  display_name?: string | null;
}

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function fmtDay(d: string | null) {
  if (!d) return null;
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function BobLogs() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [msgQuery, setMsgQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [sessRes, msgRes, propRes, usersRes] = await Promise.all([
        supabase
          .from("ai_agent_sessions")
          .select("id,user_id,property_id,title,page_context,date_range_start,date_range_end,created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("ai_agent_messages")
          .select("id,session_id,role,content,created_at")
          .order("created_at", { ascending: true })
          .limit(5000),
        supabase.from("properties").select("id,name"),
        supabase.functions.invoke("admin-users", { body: { action: "list" } }),
      ]);
      if (cancelled) return;
      if (sessRes.error) toast.error("Could not load conversations");
      setSessions(sessRes.data ?? []);
      setMessages((msgRes.data ?? []) as MessageRow[]);
      setProperties(propRes.data ?? []);
      const list = (usersRes.data as { users?: AuthUser[] } | null)?.users ?? [];
      setUsers(list);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const propMap = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);
  const messagesBySession = useMemo(() => {
    const m = new Map<string, MessageRow[]>();
    for (const row of messages) {
      const arr = m.get(row.session_id) ?? [];
      arr.push(row);
      m.set(row.session_id, arr);
    }
    return m;
  }, [messages]);

  const people = useMemo(() => {
    const byUser = new Map<string, { userId: string; sessions: number; questions: number; last: string }>();
    for (const s of sessions) {
      const prev = byUser.get(s.user_id);
      const qs = (messagesBySession.get(s.id) ?? []).filter((m) => m.role === "user").length;
      if (prev) {
        prev.sessions += 1;
        prev.questions += qs;
        if (s.created_at > prev.last) prev.last = s.created_at;
      } else {
        byUser.set(s.user_id, { userId: s.user_id, sessions: 1, questions: qs, last: s.created_at });
      }
    }
    const q = userQuery.trim().toLowerCase();
    return [...byUser.values()]
      .filter((p) => {
        if (!q) return true;
        const u = userMap.get(p.userId);
        return `${u?.display_name ?? ""} ${u?.email ?? ""}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [sessions, messagesBySession, userQuery, userMap]);

  useEffect(() => {
    if (!selectedUser && people.length) setSelectedUser(people[0].userId);
  }, [people, selectedUser]);

  const userSessions = useMemo(() => {
    const q = msgQuery.trim().toLowerCase();
    return sessions
      .filter((s) => s.user_id === selectedUser)
      .filter((s) => {
        if (!q) return true;
        const msgs = messagesBySession.get(s.id) ?? [];
        return msgs.some((m) => (m.content ?? "").toLowerCase().includes(q));
      });
  }, [sessions, selectedUser, msgQuery, messagesBySession]);

  const label = (id: string) => {
    const u = userMap.get(id);
    return u?.display_name || u?.email || "Unknown user";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bob Logs"
        description="Every question users have asked Bob, and how he answered. Super Admin only."
      />

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : people.length === 0 ? (
        <EmptyState title="No conversations yet" description="Nobody has talked to Bob so far." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="rounded-lg border bg-card">
            <div className="border-b p-3">
              <Input
                placeholder="Search users…"
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[560px]">
              <div className="p-2">
                {people.map((p) => (
                  <button
                    key={p.userId}
                    onClick={() => setSelectedUser(p.userId)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left transition-colors",
                      selectedUser === p.userId ? "bg-accent" : "hover:bg-muted",
                    )}
                  >
                    <div className="truncate text-sm font-medium">{label(p.userId)}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.questions} question{p.questions === 1 ? "" : "s"} · {p.sessions} chat
                      {p.sessions === 1 ? "" : "s"}
                    </div>
                    <div className="text-xs text-muted-foreground">Last: {fmt(p.last)}</div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          <div className="rounded-lg border bg-card">
            <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium">
                {selectedUser ? label(selectedUser) : "Select a user"}
              </div>
              <Input
                className="sm:max-w-xs"
                placeholder="Search messages…"
                value={msgQuery}
                onChange={(e) => setMsgQuery(e.target.value)}
              />
            </div>
            <ScrollArea className="h-[560px]">
              <div className="space-y-3 p-3">
                {userSessions.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">No conversations match.</div>
                ) : (
                  userSessions.map((s) => {
                    const msgs = messagesBySession.get(s.id) ?? [];
                    const firstQ = msgs.find((m) => m.role === "user")?.content ?? s.title ?? "Conversation";
                    const range =
                      fmtDay(s.date_range_start) && fmtDay(s.date_range_end)
                        ? `${fmtDay(s.date_range_start)} – ${fmtDay(s.date_range_end)}`
                        : null;
                    return (
                      <Collapsible key={s.id} className="rounded-md border">
                        <CollapsibleTrigger className="group flex w-full items-start gap-3 p-3 text-left">
                          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{firstQ}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{fmt(s.created_at)}</span>
                              {s.property_id && (
                                <Badge variant="secondary">
                                  {propMap.get(s.property_id) ?? "Unknown location"}
                                </Badge>
                              )}
                              {range && <Badge variant="outline">{range}</Badge>}
                              {s.page_context && <Badge variant="outline">{s.page_context}</Badge>}
                            </div>
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-3 border-t p-3">
                            {msgs.filter((m) => m.role === "user" || m.role === "assistant").length === 0 ? (
                              <div className="text-xs text-muted-foreground">No messages stored.</div>
                            ) : (
                              msgs
                                .filter((m) => m.role === "user" || m.role === "assistant")
                                .map((m) => (
                                  <div key={m.id} className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      {m.role === "user" ? label(s.user_id) : "Bob"} · {fmt(m.created_at)}
                                    </div>
                                    <div
                                      className={cn(
                                        "whitespace-pre-wrap break-words rounded-md p-2 text-sm",
                                        m.role === "user" ? "bg-muted" : "bg-accent/40",
                                      )}
                                    >
                                      {m.content || "(no text)"}
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
