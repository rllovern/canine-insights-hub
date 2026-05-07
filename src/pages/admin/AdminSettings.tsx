import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { SectionDivider } from "@/components/dashboard/SectionDivider";
import { Database, Phone, BarChart3, Boxes, RefreshCw, Link2, Unlink, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type Connection = {
  id: string;
  property_id: string;
  source: string;
  external_account_id: string | null;
  login_customer_id: string | null;
  status: "connected" | "error" | "disconnected";
  last_synced_at: string | null;
  last_error: string | null;
};

const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ninetyDayWindow(): { date_from: string; date_to: string } {
  const today = new Date();
  const from = new Date();
  from.setUTCDate(today.getUTCDate() - 90);
  const yest = new Date();
  yest.setUTCDate(today.getUTCDate() - 1);
  return {
    date_from: from.toISOString().slice(0, 10),
    date_to: yest.toISOString().slice(0, 10),
  };
}

export default function Settings() {
  const { clients, activeProperty, setActiveProperty } = useAuth();
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [loginCustomerId, setLoginCustomerId] = useState("");

  const fetchConn = async (clientId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("property_data_sources")
      .select("*")
      .eq("property_id", clientId)
      .eq("source", "google_ads")
      .maybeSingle();
    setConn((data as Connection) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    if (activeProperty) fetchConn(activeProperty.id);
  }, [activeProperty]);

  // Handle OAuth callback (?code=&state=)
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return;
    try {
      const parsed = JSON.parse(atob(state));
      if (parsed.kind !== "google_ads") return;
      (async () => {
        const { error } = await supabase.functions.invoke("google-ads-oauth", {
          body: {
            code,
            redirect_uri: `${window.location.origin}/settings`,
            property_id: parsed.property_id,
            external_account_id: parsed.external_account_id,
            login_customer_id: parsed.login_customer_id || null,
          },
        });
        if (error) toast.error("Failed to save connection: " + error.message);
        else {
          toast.success("Google Ads connected");
          if (activeProperty?.id === parsed.property_id) fetchConn(parsed.property_id);
        }
        // strip query params
        window.history.replaceState({}, "", "/admin/settings");
      })();
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startOAuth = () => {
    if (!activeProperty) return;
    const cleanCustomer = customerId.replace(/-/g, "").trim();
    if (!cleanCustomer) {
      toast.error("Customer ID is required");
      return;
    }
    const clientIdEnv = (import.meta as any).env.VITE_GOOGLE_OAUTH_CLIENT_ID;
    // We don't have the public property_id in frontend env; the user pastes their Google Customer ID,
    // and OAuth client id lives in the secret. Use the standard Google consent URL via the server-known client id.
    // To avoid exposing the client id in env, we route through google's URL with prompt - the secret-stored
    // client id is needed here. We will instead get it from the edge function via a small helper call.
    (async () => {
      const { data, error } = await supabase.functions.invoke("google-ads-oauth-url", {
        body: {
          property_id: activeProperty.id,
          external_account_id: cleanCustomer,
          login_customer_id: loginCustomerId.replace(/-/g, "").trim() || null,
          redirect_uri: `${window.location.origin}/settings`,
        },
      });
      if (error || !data?.url) {
        toast.error("Failed to start OAuth: " + (error?.message ?? "no url"));
        return;
      }
      window.location.href = data.url;
    })();
  };

  const disconnect = async () => {
    if (!conn) return;
    const { error } = await supabase
      .from("property_data_sources")
      .update({ status: "disconnected", refresh_token: null })
      .eq("id", conn.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Disconnected");
      if (activeProperty) fetchConn(activeProperty.id);
    }
  };

  const syncNow = async () => {
    if (!activeProperty) return;
    setSyncing(true);
    const { date_from, date_to } = ninetyDayWindow();
    const { data, error } = await supabase.functions.invoke("sync-google-ads", {
      body: { property_id: activeProperty.id, date_from, date_to },
    });
    setSyncing(false);
    if (error) toast.error("Sync failed: " + error.message);
    else {
      toast.success(`Synced ${data?.written ?? 0} rows`);
      fetchConn(activeProperty.id);
    }
  };

  // GA4 + CTM per-client connection state
  const [ga4Conn, setGa4Conn] = useState<Connection | null>(null);
  const [ctmConn, setCtmConn] = useState<Connection | null>(null);
  const [ga4PropertyId, setGa4PropertyId] = useState("");
  const [ctmAccountId, setCtmAccountId] = useState("");
  const [ga4Saving, setGa4Saving] = useState(false);
  const [ctmSaving, setCtmSaving] = useState(false);
  const [ga4Syncing, setGa4Syncing] = useState(false);
  const [ctmSyncing, setCtmSyncing] = useState(false);

  useEffect(() => {
    if (!activeProperty) return;
    (async () => {
      const { data } = await supabase
        .from("property_data_sources")
        .select("*")
        .eq("property_id", activeProperty.id)
        .in("source", ["ga4", "ctm"]);
      const g = (data ?? []).find((r: any) => r.source === "ga4") as Connection | undefined;
      const c = (data ?? []).find((r: any) => r.source === "ctm") as Connection | undefined;
      setGa4Conn(g ?? null); setCtmConn(c ?? null);
      setGa4PropertyId(g?.external_account_id ?? "");
      setCtmAccountId(c?.external_account_id ?? "");
    })();
  }, [activeProperty, syncing]);

  const saveGa4 = async () => {
    if (!activeProperty) return;
    const propId = ga4PropertyId.replace(/^properties\//, "").trim();
    if (!propId) return toast.error("GA4 Property ID is required");
    setGa4Saving(true);
    const payload = { property_id: activeProperty.id, source: "ga4" as const, external_account_id: propId, status: "connected" as const };
    const op = ga4Conn
      ? supabase.from("property_data_sources").update({ external_account_id: propId, status: "connected" }).eq("id", ga4Conn.id)
      : supabase.from("property_data_sources").insert(payload);
    const { error } = await op;
    setGa4Saving(false);
    if (error) toast.error(error.message);
    else { toast.success("GA4 property saved"); if (activeProperty) fetchConn(activeProperty.id); }
  };

  const syncGa4 = async () => {
    if (!activeProperty) return;
    setGa4Syncing(true);
    const { date_from, date_to } = ninetyDayWindow();
    const { data, error } = await supabase.functions.invoke("sync-ga4", { body: { property_id: activeProperty.id, date_from, date_to } });
    setGa4Syncing(false);
    if (error || (data as any)?.error) toast.error("GA4 sync failed: " + (error?.message ?? (data as any)?.error));
    else toast.success(`GA4: ${data?.written ?? 0} rows`);
  };

  const saveCtm = async () => {
    if (!activeProperty) return;
    if (!ctmAccountId.trim()) return toast.error("CTM Sub-account ID required");
    setCtmSaving(true);
    const payload = { property_id: activeProperty.id, source: "ctm" as const, external_account_id: ctmAccountId.trim(), status: "connected" as const };
    const op = ctmConn
      ? supabase.from("property_data_sources").update({ external_account_id: ctmAccountId.trim(), status: "connected" }).eq("id", ctmConn.id)
      : supabase.from("property_data_sources").insert(payload);
    const { error } = await op;
    setCtmSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("CTM saved"); if (activeProperty) fetchConn(activeProperty.id); }
  };

  const syncCtm = async () => {
    if (!activeProperty) return;
    setCtmSyncing(true);
    const { date_from, date_to } = ninetyDayWindow();
    const { data, error } = await supabase.functions.invoke("sync-ctm", { body: { property_id: activeProperty.id, date_from, date_to } });
    setCtmSyncing(false);
    if (error || (data as any)?.error) toast.error("CTM sync failed: " + (error?.message ?? (data as any)?.error));
    else toast.success(`CTM: ${data?.written ?? 0} rows`);
  };

  const otherSources = [
    { id: "bigquery", label: "BigQuery (blended)", icon: Boxes, desc: "Pre-blended source: CTM + GA4 at campaign level" },
  ];

  return (
    <AppShell title="Settings">
      <SectionDivider title="Data Sources" subtitle="Connect each client's accounts. Internal team only." />

      <div className="bg-card border border-border rounded-xl p-5 mb-4">
        <Label className="text-xs text-muted-foreground mb-2 block">Configuring connections for</Label>
        <Select value={activeProperty?.id ?? ""} onValueChange={(v) => {
          const c = clients.find((x) => x.id === v);
          if (c) setActiveProperty(c);
        }}>
          <SelectTrigger className="w-full md:w-80">
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Google Ads — live */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary-muted text-primary grid place-items-center">
              <BarChart3 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold tracking-tight">Google Ads</div>
                {conn?.status === "connected" && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Connected
                  </span>
                )}
                {conn?.status === "error" && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium inline-flex items-center gap-1">
                    <AlertCircle className="size-3" /> Error
                  </span>
                )}
                {(!conn || conn.status === "disconnected") && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    Not connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Cost, impressions, clicks, conversions per campaign. Synced nightly.
              </p>

              {conn?.status === "connected" && (
                <div className="mt-3 text-xs text-muted-foreground space-y-1">
                  <div>Customer ID: <code className="text-foreground font-mono">{conn.external_account_id}</code></div>
                  <div>Last synced: {timeAgo(conn.last_synced_at)}</div>
                </div>
              )}
              {conn?.status === "error" && conn.last_error && (
                <div className="mt-3 text-xs text-destructive bg-destructive/5 rounded p-2 break-words">
                  {conn.last_error}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-4">
                {conn?.status === "connected" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing}>
                      <RefreshCw className={`size-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                      {syncing ? "Syncing..." : "Sync now"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={disconnect}>
                      <Unlink className="size-3.5 mr-1.5" /> Disconnect
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!activeProperty}>
                    <Link2 className="size-3.5 mr-1.5" /> Connect
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* GA4 — live */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary-muted text-primary grid place-items-center">
              <BarChart3 className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold tracking-tight">Google Analytics 4</div>
                {ga4Conn?.status === "connected" ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Connected
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Not connected</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sessions & users by source/medium. Add the agency service account email as a Viewer in GA4 Admin → Property Access.
              </p>
              <div className="mt-3 space-y-2">
                <Label htmlFor="ga4pid" className="text-xs">GA4 Property ID</Label>
                <Input
                  id="ga4pid"
                  placeholder="123456789"
                  value={ga4PropertyId}
                  onChange={(e) => setGa4PropertyId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Numeric ID from GA4 Admin → Property Settings.</p>
              </div>
              {ga4Conn?.last_synced_at && (
                <div className="mt-2 text-xs text-muted-foreground">Last synced: {timeAgo(ga4Conn.last_synced_at)}</div>
              )}
              {ga4Conn?.last_error && (
                <div className="mt-2 text-xs text-destructive bg-destructive/5 rounded p-2 break-words">{ga4Conn.last_error}</div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={saveGa4} disabled={ga4Saving || !activeProperty}>
                  <Link2 className="size-3.5 mr-1.5" /> {ga4Saving ? "Saving..." : ga4Conn ? "Update" : "Save"}
                </Button>
                {ga4Conn && (
                  <Button size="sm" variant="outline" onClick={syncGa4} disabled={ga4Syncing}>
                    <RefreshCw className={`size-3.5 mr-1.5 ${ga4Syncing ? "animate-spin" : ""}`} />
                    {ga4Syncing ? "Syncing..." : "Sync now"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* CTM — live */}
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-lg bg-primary-muted text-primary grid place-items-center">
              <Phone className="size-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold tracking-tight">CallTrackingMetrics</div>
                {ctmConn?.status === "connected" ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success font-medium inline-flex items-center gap-1">
                    <CheckCircle2 className="size-3" /> Connected
                  </span>
                ) : (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Not connected</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Calls aggregated daily by attribution source. Use the bulk import on Properties to attach sub-accounts.
              </p>
              <div className="mt-3 space-y-2">
                <Label htmlFor="ctmid" className="text-xs">CTM Sub-account ID</Label>
                <Input
                  id="ctmid"
                  placeholder="e.g. 1234567"
                  value={ctmAccountId}
                  onChange={(e) => setCtmAccountId(e.target.value)}
                />
              </div>
              {ctmConn?.last_synced_at && (
                <div className="mt-2 text-xs text-muted-foreground">Last synced: {timeAgo(ctmConn.last_synced_at)}</div>
              )}
              {ctmConn?.last_error && (
                <div className="mt-2 text-xs text-destructive bg-destructive/5 rounded p-2 break-words">{ctmConn.last_error}</div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" onClick={saveCtm} disabled={ctmSaving || !activeProperty}>
                  <Link2 className="size-3.5 mr-1.5" /> {ctmSaving ? "Saving..." : ctmConn ? "Update" : "Save"}
                </Button>
                {ctmConn && (
                  <Button size="sm" variant="outline" onClick={syncCtm} disabled={ctmSyncing}>
                    <RefreshCw className={`size-3.5 mr-1.5 ${ctmSyncing ? "animate-spin" : ""}`} />
                    {ctmSyncing ? "Syncing..." : "Sync now"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Coming soon sources */}
        {otherSources.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.id} className="bg-card border border-border rounded-xl p-5 opacity-75">
              <div className="flex items-start gap-3">
                <div className="size-10 rounded-lg bg-muted text-muted-foreground grid place-items-center"><Icon className="size-5" /></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold tracking-tight">{s.label}</div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Coming soon</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <SectionDivider title="How nightly sync works" />
      <div className="bg-card border border-border rounded-xl p-5 text-sm text-muted-foreground space-y-2">
        <p>Every connected client's Google Ads data refreshes automatically at 04:00 UTC. Click <strong className="text-foreground">Sync now</strong> on any connected client to pull immediately.</p>
        <p>If a client revokes access on their Google account, the connection moves to <strong className="text-destructive">Error</strong> state — reconnect from this page.</p>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Google Ads</DialogTitle>
            <DialogDescription>
              Enter the client's Google Ads Customer ID, then authorize via Google.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cid">Google Ads Customer ID</Label>
              <Input id="cid" placeholder="123-456-7890" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Found in the top-right of Google Ads UI.</p>
            </div>
            <div>
              <Label htmlFor="lcid">MCC Login Customer ID (optional)</Label>
              <Input id="lcid" placeholder="098-765-4321" value={loginCustomerId} onChange={(e) => setLoginCustomerId(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Required if accessing via your manager account.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={startOAuth}>Authorize with Google</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
