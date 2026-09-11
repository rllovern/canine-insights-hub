import { useEffect, useMemo, useState } from "react";
import { Copy, Download, FileJson, FileSpreadsheet, FileText, Loader2, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { downloadCsv, downloadJson, downloadPdf } from "@/lib/onboarding/exports";
import { flattenAnswers, type Answers } from "@/lib/onboarding/schema";
import { generateReportToken } from "@/lib/tokens";

type Invite = {
  id: string;
  property_id: string | null;
  location_label: string;
  contact_name: string | null;
  contact_email: string;
  token: string;
  status: string;
  expires_at: string;
  updated_at: string;
};

type Submission = {
  id: string;
  invite_id: string;
  answers: Answers;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  updated_at: string;
};

type Flag = { id: string; submission_id: string; flag_type: string; severity: string; field_key: string | null; detail: string | null };

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  approved: "Approved",
};

export default function AdminOnboarding() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [properties, setProperties] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ property_id: "", location_label: "", contact_name: "", contact_email: "", monthly_budget: "", territory: "" });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const [inv, subs, fl, props] = await Promise.all([
      supabase.from("onboarding_invites").select("*").order("created_at", { ascending: false }),
      supabase.from("onboarding_submissions").select("*"),
      supabase.from("onboarding_flags").select("*"),
      supabase.from("properties").select("id,name").order("name"),
    ]);
    setInvites((inv.data ?? []) as Invite[]);
    setSubmissions((subs.data ?? []) as Submission[]);
    setFlags((fl.data ?? []) as Flag[]);
    setProperties((props.data ?? []) as Array<{ id: string; name: string }>);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const submissionFor = (inviteId: string) => submissions.find((s) => s.invite_id === inviteId);
  const open = invites.find((i) => i.id === openId) ?? null;
  const openSubmission = open ? submissionFor(open.id) : null;
  const openFlags = useMemo(
    () => (openSubmission ? flags.filter((f) => f.submission_id === openSubmission.id) : []),
    [flags, openSubmission],
  );

  const linkFor = (t: string) => `${window.location.origin}/onboarding/${t}`;

  const createInvite = async () => {
    if (!form.location_label.trim() || !form.contact_email.trim()) {
      toast({ title: "Location and email are required", variant: "destructive" });
      return;
    }
    setCreating(true);
    const prefill: Record<string, string> = { location_label: form.location_label };
    if (form.monthly_budget) prefill.monthly_budget = `Monthly ad budget: $${form.monthly_budget}`;
    if (form.territory) prefill.contracted_territory = form.territory;
    const token = generateReportToken() + generateReportToken().slice(0, 8);
    const { error } = await supabase.from("onboarding_invites").insert({
      property_id: form.property_id || null,
      location_label: form.location_label.trim(),
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim(),
      token,
      prefill,
    });
    setCreating(false);
    if (error) { toast({ title: "Could not create the invite", description: error.message, variant: "destructive" }); return; }
    setNewOpen(false);
    setForm({ property_id: "", location_label: "", contact_name: "", contact_email: "", monthly_budget: "", territory: "" });
    await load();
    await navigator.clipboard.writeText(linkFor(token)).catch(() => null);
    toast({ title: "Invite created", description: "The private link is on your clipboard." });
  };

  const approve = async (submission: Submission) => {
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("onboarding_submissions")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: userRes.user?.id ?? null })
      .eq("id", submission.id);
    if (error) { toast({ title: "Could not approve", description: error.message, variant: "destructive" }); return; }
    await supabase.from("onboarding_invites").update({ status: "approved" }).eq("id", submission.invite_id);
    toast({ title: "Marked approved" });
    void load();
  };

  const applyToProperty = async (invite: Invite, submission: Submission) => {
    if (!invite.property_id) { toast({ title: "Link this invite to a location first", variant: "destructive" }); return; }
    const a = submission.answers;
    const targetCpl = Number(a.target_cpl);
    if (!Number.isFinite(targetCpl)) { toast({ title: "No target cost per lead to apply", variant: "destructive" }); return; }
    const periodStart = new Date();
    periodStart.setDate(1);
    const { error } = await supabase.from("property_targets").insert({
      property_id: invite.property_id,
      period_start: periodStart.toISOString().slice(0, 10),
      cpl_target: targetCpl,
    });
    if (error) { toast({ title: "Could not apply", description: error.message, variant: "destructive" }); return; }
    const { data: userRes } = await supabase.auth.getUser();
    await supabase.from("onboarding_field_applications").insert({
      submission_id: submission.id,
      field_key: "target_cpl",
      target_table: "property_targets",
      target_column: "cpl_target",
      value_json: targetCpl,
      applied_by: userRes.user?.id ?? null,
    });
    toast({ title: "Target cost per lead applied to the location" });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        description="Send the location questionnaire, track who has finished it, and review the answers."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New invite
            </Button>
          </div>
        }
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="grid place-items-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : invites.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No questionnaires sent yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((inv) => {
                const sub = submissionFor(inv.id);
                const count = sub ? flags.filter((f) => f.submission_id === sub.id).length : 0;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.location_label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{inv.contact_name ?? inv.contact_email}</TableCell>
                    <TableCell>
                      <Badge variant={inv.status === "submitted" || inv.status === "approved" ? "default" : "secondary"}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{count ? <Badge variant="destructive">{count}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(sub?.updated_at ?? inv.updated_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { void navigator.clipboard.writeText(linkFor(inv.token)); toast({ title: "Link copied" }); }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" disabled={!sub} onClick={() => setOpenId(inv.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New onboarding invite</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Existing location (optional)</Label>
              <Select value={form.property_id} onValueChange={(v) => setForm((f) => ({ ...f, property_id: v, location_label: f.location_label || (properties.find((p) => p.id === v)?.name ?? "") }))}>
                <SelectTrigger><SelectValue placeholder="Not linked yet" /></SelectTrigger>
                <SelectContent>
                  {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Location name shown to the owner</Label>
              <Input value={form.location_label} onChange={(e) => setForm((f) => ({ ...f, location_label: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Contact name</Label>
              <Input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Contact email</Label>
              <Input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Monthly budget to confirm</Label>
                <Input value={form.monthly_budget} onChange={(e) => setForm((f) => ({ ...f, monthly_budget: e.target.value }))} placeholder="3000" />
              </div>
              <div className="space-y-1">
                <Label>Contracted territory</Label>
                <Input value={form.territory} onChange={(e) => setForm((f) => ({ ...f, territory: e.target.value }))} placeholder="Ashtabula County, OH" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={() => void createInvite()} disabled={creating}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create and copy link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{open?.location_label}</DialogTitle></DialogHeader>
          {open && openSubmission && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadPdf(open.location_label, openSubmission.answers, { submittedAt: openSubmission.submitted_at })}>
                  <FileText className="mr-1 h-4 w-4" /> PDF
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadCsv(open.location_label, openSubmission.answers)}>
                  <FileSpreadsheet className="mr-1 h-4 w-4" /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadJson(open.location_label, { invite: open, submission: openSubmission, flags: openFlags })}>
                  <FileJson className="mr-1 h-4 w-4" /> JSON
                </Button>
                <Button variant="outline" size="sm" onClick={() => void applyToProperty(open, openSubmission)}>
                  <Download className="mr-1 h-4 w-4" /> Apply target CPL
                </Button>
                {openSubmission.status !== "approved" && (
                  <Button size="sm" onClick={() => void approve(openSubmission)}>
                    <ShieldCheck className="mr-1 h-4 w-4" /> Mark approved
                  </Button>
                )}
              </div>

              {openFlags.length > 0 && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium">Review notes</p>
                  {openFlags.map((f) => (
                    <p key={f.id} className="text-sm text-muted-foreground">
                      <Badge variant={f.severity === "high" ? "destructive" : "secondary"} className="mr-2">{f.severity}</Badge>
                      {f.detail}
                    </p>
                  ))}
                </div>
              )}

              <div className="space-y-4">
                {(() => {
                  const rows = flattenAnswers(openSubmission.answers);
                  let current = "";
                  return rows.map((r, i) => {
                    const heading = r.section !== current;
                    current = r.section;
                    return (
                      <div key={i}>
                        {heading && <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{r.section}</h3>}
                        <div className="rounded-md border border-border p-3">
                          <p className="text-xs font-medium text-muted-foreground">{r.label}</p>
                          <p className="whitespace-pre-wrap text-sm">{r.value}</p>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
