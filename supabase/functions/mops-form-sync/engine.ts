// Form Sync engine: discovery -> duplicate check -> (optional) delivery -> verification -> qualification.
// All I/O is injected so the same code runs in production and in the scenario tests.
import { attributionOf, backoffMinutes, buildCtmPayload, classify, maskEmail, maskName, maskPayload, maskPhone, normMsg, sha256,
  type CtmActivity, type FormMapEntry, type GhlSubmission, type HashedActivity } from "./logic.ts";
import { NORCAL, productionEvidence } from "./production-watch.ts";

export type PostResult =
  | { kind: "accepted"; ref: string | null }
  | { kind: "rejected"; status: number; error: string }
  | { kind: "ambiguous"; error: string };

export interface Deps {
  call: (op: string, args?: Record<string, unknown>) => Promise<any>;
  ghlList: (from: Date, to: Date) => Promise<GhlSubmission[]>;
  ctmList: (from: Date, to: Date) => Promise<CtmActivity[]>;
  ctmGet: (id: string) => Promise<{ tag: string | null; created_iso: string; message?: string | null; askai_verified?: boolean } | null>;
  ctmPost: (payload: Record<string, string>) => Promise<PostResult>;
  now: () => Date;
  /** Location flag AND global kill switch. False = never posts. */
  live: boolean;
}

const MIN = 60000, DAY = 86400000;
const VERIFY_WINDOW_MIN = 15;

async function hashActs(acts: CtmActivity[]): Promise<HashedActivity[]> {
  return Promise.all(acts.map(async (a) => ({ ...a, message_hash: a.message ? await sha256(normMsg(a.message)) : null })));
}

export async function runLocation(d: Deps, pid: string, opts: { from?: string } = {}) {
  const { config: cfg, checkpoint } = await d.call("formsync_config", { property_id: pid });
  if (!cfg) throw new Error("Form Sync is not set up for this location");
  const now = d.now();
  const guarded = pid === NORCAL && cfg.production_watch_limit === 5;
  const stop = async (reason: string) => {
    await d.call("formsync_safety", { property_id: pid, action: "stop", reason });
    throw new Error(`NorCal automatic sending paused: ${reason}`);
  };
  const formMap = (cfg.form_map ?? {}) as Record<string, FormMapEntry>;
  const activation = cfg.activation_at ? Date.parse(cfg.activation_at) : Infinity;

  // 1. Discovery with overlapping windows and catch-up after outages (GHL keeps history; cap 30 days).
  const lookback = cfg.lookback_minutes * MIN;
  let from = checkpoint?.last_window_end ? new Date(Math.min(Date.parse(checkpoint.last_window_end) - lookback, now.getTime() - lookback)) : new Date(now.getTime() - lookback);
  if (opts.from) from = new Date(opts.from);
  if (from.getTime() < now.getTime() - 30 * DAY) from = new Date(now.getTime() - 30 * DAY);

  const before = await d.call("formsync_work", { property_id: pid });
  const earliestOpen = Math.min(from.getTime(), ...((before.submissions ?? []) as any[]).filter((s) => s.status !== "matched" && s.status !== "delivered").map((s) => Date.parse(s.submitted_at) - 60 * MIN));
  const ghlFrom = new Date(Math.max(earliestOpen, now.getTime() - 30 * DAY));
  const ghlAll = await d.ghlList(ghlFrom, now);
  const inWindow = ghlAll.filter((s) => Date.parse(s.createdAt) >= from.getTime());
  const items = await Promise.all(inWindow.map(async (s) => {
    const o = s.others ?? {};
    const mk = (s.formId ? formMap[s.formId]?.message_key : null) ?? cfg.ghl_message_key;
    const msg = mk ? o[mk] : null;
    return { ghl_submission_id: s.id, ghl_contact_id: s.contactId ?? null, ghl_form_id: s.formId ?? null, submitted_at: s.createdAt,
      masked: { name: maskName(s.name ?? `${o.first_name ?? ""} ${o.last_name ?? ""}`.trim()), email: maskEmail(String(o.email ?? s.email ?? "")), phone: maskPhone(String(o.phone ?? "")), has_message: !!msg },
      message_hash: msg ? await sha256(normMsg(msg)) : null, attribution: attributionOf(s) };
  }));
  const ing = await d.call("formsync_ingest", { property_id: pid, items, window_end: now.toISOString() });

  const work = ((await d.call("formsync_work", { property_id: pid })).submissions ?? []) as any[];
  const claimed = new Set<string>(((await d.call("formsync_claimed", { property_id: pid })).claimed ?? []).map(String));
  const subsById = new Map(ghlAll.map((s) => [s.id, s]));
  const res = { fetched: inWindow.length, new: ing.new ?? 0, matched: 0, delivered: 0, needs_review: 0, pending: 0, failed: 0, posted: 0, ambiguous: 0, qualification_checked: 0, needs_qualification: 0, live: d.live };

  // 2. Duplicate check for every open row (one CTM read for the run).
  const open = work.filter((s) => ["received", "pending_delivery", "pending_verification", "failed"].includes(s.status))
    .sort((a, b) => Date.parse(a.submitted_at) - Date.parse(b.submitted_at));
  let acts: HashedActivity[] = [];
  if (open.length) {
    const t = open.map((s) => Date.parse(s.submitted_at));
    acts = await hashActs(await d.ctmList(new Date(Math.min(...t) - DAY), new Date(now.getTime() + DAY)));
  }
  const formId = String(cfg.ctm_form_numeric_id);
  const toDeliver: any[] = [];
  for (const s of open) {
    const v = classify({ ghl_submission_id: s.ghl_submission_id, contact_id: s.ghl_contact_id, submitted_at: s.submitted_at, message_hash: s.message_hash, delivery_ref: s.delivery_ref, form_source: s.ghl_form_id ? formMap[s.ghl_form_id]?.form_source ?? null : null }, formId, acts, claimed, { composite: cfg.composite_match === true });
    const detail = { checked_at: now.toISOString(), via: v.via, ctm_activities_scanned: acts.length, candidates: v.candidates };
    if (v.status === "matched" && v.activity_id) {
      claimed.add(v.activity_id);
      const ours = s.status === "pending_verification" || !!s.delivery_ref;
      const act = acts.find((a) => a.id === v.activity_id);
      await d.call("formsync_set", { id: s.id, status: ours ? "delivered" : "matched", ctm_activity_id: v.activity_id, recovered: ours, match_detail: detail,
        ctm_created_at: act?.called_at_iso ?? "", qualification: "pending", last_error: "", kind: ours ? "verify" : "reconcile", log: { via: v.via } });
      ours ? res.delivered++ : res.matched++;
      continue;
    }
    if (v.status === "needs_review") {
      await d.call("formsync_set", { id: s.id, status: "needs_review", match_detail: detail, kind: "reconcile", log: { candidates: v.candidates.length } });
      res.needs_review++; continue;
    }
    // Nothing in CTM for this submission.
    // Monitoring-only locations: after 7 days an unconfirmed lead is parked (already alerted) so runs stay bounded.
    if (!d.live && now.getTime() - Date.parse(s.submitted_at) > 7 * DAY) {
      await d.call("formsync_set", { id: s.id, status: "held", hold_reason: "monitor_unconfirmed", match_detail: detail, kind: "reconcile", log: { parked: "unconfirmed_after_7_days" } });
      res.pending++; continue;
    }
    if (s.status === "pending_verification") {
      const posted = s.posted_at ? Date.parse(s.posted_at) : 0;
      if (now.getTime() - posted >= VERIFY_WINDOW_MIN * MIN) {
        await d.call("formsync_set", { id: s.id, status: "pending_delivery", match_detail: detail, kind: "verify", log: { result: "not_in_ctm_after_verification_window" } });
        s.status = "pending_delivery";
      } else { res.pending++; continue; }
    } else if (s.status === "received") {
      await d.call("formsync_set", { id: s.id, status: "pending_delivery", match_detail: detail, kind: "reconcile", log: { candidates: 0 } });
      s.status = "pending_delivery";
    }
    toDeliver.push(s);
  }

  // 3. Delivery (only when live). Grace period, eligibility, lock, fresh check, then post.
  for (const s of toDeliver) {
    const orig = subsById.get(s.ghl_submission_id);
    const form = s.ghl_form_id ? formMap[s.ghl_form_id] : undefined;
    // Restricted test window: when test_email is set, ONLY that exact email inside the window may be sent.
    const testEmail = String(cfg.test_email ?? "").trim().toLowerCase();
    const origEmail = String(orig?.others?.email ?? orig?.email ?? "").trim().toLowerCase();
    const sub = Date.parse(s.submitted_at);
    const testOk = !testEmail || (origEmail === testEmail && !!cfg.test_window_start && sub >= Date.parse(cfg.test_window_start)
      && !!cfg.test_window_end && now.getTime() <= Date.parse(cfg.test_window_end));
    const eligible = (sub >= activation || !!s.approved_at) && !!form && testOk;
    const graceOk = Date.parse(s.submitted_at) + cfg.grace_minutes * MIN <= now.getTime();
    const retryOk = !s.next_attempt_at || Date.parse(s.next_attempt_at) <= now.getTime();
    const underMax = (s.attempts ?? 0) < cfg.max_attempts;
    const payload = orig && form ? buildCtmPayload(orig, form.message_key ?? cfg.ghl_message_key, cfg.message_field, form) : null;
    if (guarded && eligible && payload && !normMsg(payload[`custom_${cfg.message_field}`])) {
      await d.call("formsync_set", { id: s.id, status: "needs_review", last_error: "Missing GHL customer inquiry — no recovery attempted", kind: "review", log: { reason: "missing_inquiry" } });
      res.needs_review++; continue;
    }
    if (payload && s.status === "pending_delivery") {
      await d.call("formsync_set", { id: s.id, kind: "plan", dry_run_payload: { target: { method: "POST", form_reactor: cfg.ctm_form_reactor_id, form_reactor_numeric_id: formId }, fields: maskPayload(payload, cfg.message_field) }, log: { planned: true } });
    }
    if (!d.live || !eligible || !graceOk || !retryOk || !underMax || !payload) { s.status === "failed" ? res.failed++ : res.pending++; continue; }

    const { lock } = await d.call("formsync_claim", { id: s.id, seconds: 120 });
    if (!lock) { res.pending++; continue; }
    let fresh: HashedActivity[];
    try {
      fresh = await hashActs(await d.ctmList(new Date(Date.parse(s.submitted_at) - DAY), new Date(d.now().getTime() + DAY)));
    } catch (e) {
      await d.call("formsync_set", { id: s.id, lock, last_error: `CTM check failed: ${(e as Error).message}`, next_attempt_at: new Date(now.getTime() + 5 * MIN).toISOString(), kind: "precheck", log: { error: (e as Error).message } });
      res.pending++; continue;
    }
    const v = classify({ ghl_submission_id: s.ghl_submission_id, contact_id: s.ghl_contact_id, submitted_at: s.submitted_at, message_hash: s.message_hash,
      form_source: form?.form_source ?? null }, formId, fresh, claimed, { composite: cfg.composite_match === true });
    if (v.status !== "pending_delivery") {
      const st = v.status === "matched" ? "matched" : "needs_review";
      await d.call("formsync_set", { id: s.id, lock, status: st, ctm_activity_id: v.activity_id ?? "", qualification: st === "matched" ? "pending" : "", match_detail: { checked_at: d.now().toISOString(), via: v.via, candidates: v.candidates, stage: "pre-delivery" }, kind: "precheck", log: { stopped: st } });
      if (v.activity_id) claimed.add(v.activity_id);
      st === "matched" ? res.matched++ : res.needs_review++;
      continue;
    }
    if (guarded) {
      const { allowed } = await d.call("formsync_safety", { property_id: pid, action: "can_send", id: s.id });
      if (!allowed) { res.pending++; continue; }
    }
    // Mark in-flight BEFORE posting: if anything breaks mid-post, the next run verifies instead of re-sending.
    const moved = await d.call("formsync_set", { id: s.id, lock, status: "pending_verification", posted_at: d.now().toISOString(), count_attempt: true, kind: "deliver", log: { posting: true } });
    if (!moved.ok) { res.pending++; continue; }
    res.posted++;
    const r = await d.ctmPost(payload);
    if (r.kind === "rejected") {
      const n = (s.attempts ?? 0) + 1;
      await d.call("formsync_set", { id: s.id, status: "failed", last_error: `CTM rejected (${r.status}): ${r.error}`.slice(0, 300), next_attempt_at: new Date(d.now().getTime() + backoffMinutes(n) * MIN).toISOString(), kind: "deliver", log: { rejected: r.status } });
      res.failed++;
      if (guarded) await stop(`CTM rejected recovery (${r.status})`);
      continue;
    }
    if (r.kind === "ambiguous") {
      await d.call("formsync_set", { id: s.id, last_error: `Unclear CTM response: ${r.error}`.slice(0, 300), kind: "deliver", log: { ambiguous: true } });
      res.ambiguous++;
      if (guarded) await stop("Recovery response uncertain; verify the existing attempt before resuming");
      continue;
    }
    await d.call("formsync_set", { id: s.id, delivery_ref: r.ref ?? "", kind: "deliver", log: { accepted: true } });
    // Immediate verification by submission ID / receipt reference.
    try {
      const after = await hashActs(await d.ctmList(new Date(Date.parse(s.submitted_at) - DAY), new Date(d.now().getTime() + DAY)));
      const vv = classify({ ghl_submission_id: s.ghl_submission_id, contact_id: null, submitted_at: s.submitted_at, message_hash: null, delivery_ref: r.ref }, formId, after.filter((a) => a.submission_id || a.trackback_id), claimed);
      if (vv.status === "matched" && vv.activity_id && vv.via !== "score") {
        claimed.add(vv.activity_id);
        const act = after.find((a) => a.id === vv.activity_id);
        await d.call("formsync_set", { id: s.id, status: "delivered", ctm_activity_id: vv.activity_id, recovered: true, last_error: "", ctm_created_at: act?.called_at_iso ?? "", qualification: "pending", kind: "verify", log: { via: vv.via } });
        res.delivered++; continue;
      }
    } catch { /* next run verifies */ }
    res.pending++;
  }

  // Persisted first-five watch; includes already matched rows and is independent of the dashboard.
  if (guarded) {
    const { submissions: watched } = await d.call("formsync_safety", { property_id: pid, action: "watch" });
    if (watched?.length) {
      const scan = await d.ctmList(new Date(Math.min(...watched.map((s: any) => Date.parse(s.submitted_at))) - DAY), new Date(d.now().getTime() + DAY));
      for (const s of watched) {
        const orig = subsById.get(s.ghl_submission_id);
        const form = formMap[s.ghl_form_id];
        if (!orig || !form) continue;
        const ev = productionEvidence(orig, form.message_key ?? cfg.ghl_message_key ?? "", form.form_source, formId, scan);
        const a = ev.activity_count === 1 ? await d.ctmGet(ev.activity_ids[0]) : null;
        const askai = a?.askai_verified === true;
        const reasons = [!ev.inquiry_present ? "missing_ghl_inquiry" : null,
          ev.activity_count === 1 && !ev.inquiry_complete ? "missing_or_incomplete_ctm_inquiry" : null,
          ev.activity_count === 1 && !askai ? "askai_provenance_unverified" : null].filter(Boolean);
        await d.call("formsync_safety", { property_id: pid, action: "record", id: s.id, evidence: { ...ev,
          delivery_origin: s.recovered ? "Lovable recovery" : s.status === "matched" ? "Website/existing CTM" : "not confirmed",
          askai_verified: askai, tag_observed: a?.tag ?? null, review_reasons: reasons, checked_at: d.now().toISOString() } });
        if (ev.activity_count > 1) await stop("Multiple CTM activities may represent a production submission");
        if (s.posted_at && ev.activity_count === 0 && d.now().getTime() - Date.parse(s.posted_at) >= VERIFY_WINDOW_MIN * MIN)
          await stop("Recovery not verified after 15 minutes");
      }
    }
  }

  // 4. Qualification monitoring (dashboard status only; never writes to CTM).
  const confirmed = ((await d.call("formsync_work", { property_id: pid })).submissions ?? []) as any[];
  for (const s of confirmed.filter((x) => ["matched", "delivered"].includes(x.status) && x.ctm_activity_id && (Date.parse(x.submitted_at) >= activation || x.approved_at))) {
    const a = await d.ctmGet(String(s.ctm_activity_id));
    if (!a) continue;
    res.qualification_checked++;
    const created = Date.parse(a.created_iso);
    const q = guarded ? (normMsg(a.message) && a.askai_verified === true && a.tag ? "classified" : "needs_qualification")
      : a.tag ? "classified" : (d.now().getTime() - created >= cfg.qualify_minutes * MIN ? "needs_qualification" : "pending");
    if (q === "needs_qualification") res.needs_qualification++;
    await d.call("formsync_qualify", { id: s.id, qualification: q, ctm_tag: a.tag ?? "", ctm_created_at: a.created_iso, changed: q !== (s.qualification ?? "pending") });
  }
  return res;
}
