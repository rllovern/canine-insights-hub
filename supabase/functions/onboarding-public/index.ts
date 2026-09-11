// Public endpoint for the location onboarding questionnaire.
// The owner is anonymous: every request carries the invite token, which is
// resolved server-side before any read or write happens with the service role.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildFlags, formatErrors, incompleteSections, normalize, type Answers } from "./validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Crude per-token throttle so a runaway client cannot hammer the database.
const hits = new Map<string, number[]>();
function throttled(token: string, limit = 40, windowMs = 60_000) {
  const now = Date.now();
  const list = (hits.get(token) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(token, list);
  return list.length > limit;
}

type Invite = {
  id: string;
  property_id: string | null;
  location_label: string;
  contact_name: string | null;
  contact_email: string;
  prefill: Record<string, unknown>;
  status: string;
  expires_at: string;
  revoked_at: string | null;
  last_sent_at: string | null;
};

async function resolveInvite(token: string): Promise<{ invite?: Invite; error?: string; status?: number }> {
  if (!token || typeof token !== "string" || token.length < 16) return { error: "Invalid link", status: 400 };
  const { data, error } = await admin
    .from("onboarding_invites")
    .select("id, property_id, location_label, contact_name, contact_email, prefill, status, expires_at, revoked_at, last_sent_at")
    .eq("token", token)
    .maybeSingle();
  if (error) return { error: "Could not open this questionnaire", status: 500 };
  if (!data) return { error: "This link is not valid.", status: 404 };
  if (data.revoked_at) return { error: "This link has been turned off. Ask your account manager for a new one.", status: 403 };
  if (new Date(data.expires_at) < new Date()) return { error: "This link has expired. Ask your account manager for a new one.", status: 403 };
  return { invite: data as Invite };
}

async function getOrCreateSubmission(invite: Invite) {
  const { data } = await admin.from("onboarding_submissions").select("*").eq("invite_id", invite.id).maybeSingle();
  if (data) return data;
  const { data: created, error } = await admin
    .from("onboarding_submissions")
    .insert({ invite_id: invite.id, property_id: invite.property_id })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return created;
}

async function sendLinkEmail(to: string, label: string, url: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { sent: false, reason: "no_sender" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Ridgeside Insights <onboarding@notify.rsk9insights.com>",
      to: [to],
      subject: `Your onboarding questionnaire — ${label}`,
      html: `<p>Here is your private link to the ${label} onboarding questionnaire. It saves as you go, so you can stop and come back to it.</p><p><a href="${url}">Open the questionnaire</a></p><p>If you did not expect this, you can ignore it.</p>`,
    }),
  });
  if (!res.ok) return { sent: false, reason: await res.text() };
  return { sent: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const action = String(body.action ?? "");
  const token = String(body.token ?? "");
  if (throttled(token)) return json({ error: "Too many requests — give it a moment." }, 429);

  const { invite, error, status } = await resolveInvite(token);
  if (!invite) return json({ error }, status ?? 400);

  try {
    const submission = await getOrCreateSubmission(invite);

    if (action === "load") {
      return json({
        ok: true,
        invite: {
          location_label: invite.location_label,
          contact_name: invite.contact_name,
          contact_email: invite.contact_email,
          prefill: invite.prefill ?? {},
        },
        submission: {
          answers: submission.answers ?? {},
          current_section: submission.current_section ?? 0,
          status: submission.status,
          submitted_at: submission.submitted_at,
        },
      });
    }

    if (submission.status === "submitted" || submission.status === "approved") {
      if (action === "save" || action === "submit") return json({ error: "This questionnaire has already been submitted." }, 409);
    }

    if (action === "save") {
      const answers = normalize((body.answers ?? {}) as Answers);
      const currentSection = Number(body.current_section ?? submission.current_section ?? 0);
      const { error: uErr } = await admin
        .from("onboarding_submissions")
        .update({ answers, current_section: currentSection, status: "in_progress" })
        .eq("id", submission.id);
      if (uErr) return json({ error: uErr.message }, 500);
      if (invite.status === "not_started") {
        await admin.from("onboarding_invites").update({ status: "in_progress" }).eq("id", invite.id);
      }
      return json({ ok: true, saved_at: new Date().toISOString(), format_warnings: formatErrors(answers) });
    }

    if (action === "submit") {
      const answers = normalize((body.answers ?? {}) as Answers);
      const fmt = formatErrors(answers);
      if (fmt.length) return json({ error: fmt.join(" · "), field_errors: fmt }, 400);
      const missing = incompleteSections(answers);
      if (missing.length) return json({ error: "Some required sections are not finished yet.", missing_sections: missing }, 400);

      // Territory overlap is checked against every other location's answers.
      const { data: others } = await admin
        .from("onboarding_submissions")
        .select("id, answers, onboarding_invites!inner(location_label)")
        .neq("id", submission.id);
      const otherAreas = (others ?? []).map((o: Record<string, unknown>) => ({
        label: ((o.onboarding_invites as { location_label?: string })?.location_label) ?? "another location",
        areas: (((o.answers as Answers)?.service_areas as string[]) ?? []),
      }));

      const flags = buildFlags(answers, otherAreas);

      const { error: sErr } = await admin
        .from("onboarding_submissions")
        .update({ answers, status: "submitted", submitted_at: new Date().toISOString() })
        .eq("id", submission.id);
      if (sErr) return json({ error: sErr.message }, 500);

      await admin.from("onboarding_flags").delete().eq("submission_id", submission.id);
      if (flags.length) {
        await admin.from("onboarding_flags").insert(flags.map((f) => ({ ...f, submission_id: submission.id })));
      }
      await admin.from("onboarding_invites").update({ status: "submitted" }).eq("id", invite.id);

      const origin = String(body.app_url ?? "");
      if (invite.contact_email && origin) {
        await sendLinkEmail(invite.contact_email, invite.location_label, `${origin}/onboarding/${token}`).catch(() => null);
      }
      return json({ ok: true, flags: flags.length });
    }

    if (action === "resend") {
      const last = invite.last_sent_at ? Date.parse(invite.last_sent_at) : 0;
      if (Date.now() - last < 120_000) return json({ error: "We just sent that. Check your inbox and spam folder." }, 429);
      const origin = String(body.app_url ?? "");
      const target = String(body.email ?? invite.contact_email);
      if (target.toLowerCase() !== invite.contact_email.toLowerCase()) {
        return json({ error: "That email does not match the one this link was sent to." }, 403);
      }
      const result = await sendLinkEmail(target, invite.location_label, `${origin}/onboarding/${token}`);
      if (result.sent) await admin.from("onboarding_invites").update({ last_sent_at: new Date().toISOString() }).eq("id", invite.id);
      return json({ ok: result.sent, reason: result.reason ?? null });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("onboarding-public failed:", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
