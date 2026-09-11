import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FieldInput } from "@/components/onboarding/FieldInput";
import {
  SECTIONS,
  outstandingSections,
  sectionComplete,
  totalEstimatedMinutes,
  validateSection,
  visibleFields,
  type Answers,
} from "@/lib/onboarding/schema";
import ridgesideLogo from "@/assets/ridgeside-logo-full.webp";

type InviteInfo = { location_label: string; contact_name: string | null; contact_email: string; prefill: Record<string, unknown> };

const REVIEW_INDEX = SECTIONS.length;

export default function Onboarding() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(false);
  const latest = useRef<{ answers: Answers; step: number }>({ answers: {}, step: 0 });

  const call = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const { data, error } = await supabase.functions.invoke("onboarding-public", {
        body: { action, token, app_url: window.location.origin, ...payload },
      });
      if (error) {
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx) detail = (JSON.parse(await ctx.text()) as { error?: string }).error ?? detail;
        } catch { /* keep the generic message */ }
        throw new Error(detail);
      }
      return data as Record<string, unknown>;
    },
    [token],
  );

  useEffect(() => {
    if (!token) return;
    call("load")
      .then((d) => {
        setInvite(d.invite as InviteInfo);
        const sub = d.submission as { answers: Answers; current_section: number; status: string };
        setAnswers(sub.answers ?? {});
        setStep(Math.min(sub.current_section ?? 0, REVIEW_INDEX));
        if (sub.status === "submitted" || sub.status === "approved") setSubmitted(true);
      })
      .catch((e) => setLoadError(e.message));
  }, [token, call]);

  useEffect(() => {
    latest.current = { answers, step };
  }, [answers, step]);

  // Autosave every few seconds while there are unsaved edits.
  useEffect(() => {
    if (submitted || !invite) return;
    const id = setInterval(async () => {
      if (!dirty.current) return;
      dirty.current = false;
      setSaving(true);
      try {
        const res = await call("save", { answers: latest.current.answers, current_section: latest.current.step });
        setSavedAt((res.saved_at as string) ?? new Date().toISOString());
      } catch {
        dirty.current = true;
      } finally {
        setSaving(false);
      }
    }, 4000);
    return () => clearInterval(id);
  }, [call, invite, submitted]);

  const setValue = (key: string, v: unknown) => {
    dirty.current = true;
    setAnswers((prev) => ({ ...prev, [key]: v }));
  };

  const section = step < SECTIONS.length ? SECTIONS[step] : null;
  const errors = useMemo(() => (section ? validateSection(section, answers) : {}), [section, answers]);
  const completedCount = SECTIONS.filter((s) => sectionComplete(s, answers)).length;
  const percent = Math.round((Math.min(step, SECTIONS.length) / (SECTIONS.length + 1)) * 100);
  const minutesLeft = SECTIONS.slice(step).reduce((n, s) => n + s.estMinutes, 0);
  const outstanding = useMemo(() => outstandingSections(answers), [answers]);

  const goNext = async () => {
    if (section && Object.keys(errors).length) {
      setShowErrors(true);
      toast({ title: "A few answers need attention", description: "The highlighted questions are required.", variant: "destructive" });
      return;
    }
    setShowErrors(false);
    const next = Math.min(step + 1, REVIEW_INDEX);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    dirty.current = false;
    try {
      const res = await call("save", { answers, current_section: next });
      setSavedAt((res.saved_at as string) ?? new Date().toISOString());
    } catch { dirty.current = true; }
  };

  const goBack = () => {
    setShowErrors(false);
    setStep((s) => Math.max(0, s - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await call("submit", { answers });
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast({ title: "Could not submit", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div className="max-w-md space-y-3">
          <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{loadError}</h1>
          <p className="text-sm text-muted-foreground">Get in touch with your account manager and we will send a fresh link.</p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div className="max-w-md space-y-3">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <Check className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Thank you — that is everything we needed</h1>
          <p className="text-sm text-muted-foreground">
            Your answers for {invite.location_label} are with the team. We will be in touch about account access and anything that
            needs a second look.
          </p>
        </div>
      </div>
    );
  }

  const prefill = invite.prefill ?? {};

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <img src={ridgesideLogo} alt="Ridgeside K9" className="h-7 w-auto" />
            <span className="text-xs text-muted-foreground">
              {saving ? "Saving…" : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Saves automatically"}
            </span>
          </div>
          <Progress value={percent} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {invite.location_label} · {completedCount} of {SECTIONS.length} sections done
            </span>
            <span>{step >= SECTIONS.length ? "Final check" : `About ${minutesLeft} min left`}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        {section ? (
          <section className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Step {step + 1} of {SECTIONS.length + 1}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">{section.title}</h1>
              {section.blurb && <p className="mt-2 text-sm text-muted-foreground">{section.blurb}</p>}
              {section.key === "trainers" && (
                <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                  This section is optional — you can submit without it and send the details later.
                </p>
              )}
            </div>

            <div className="space-y-6 rounded-xl border border-border bg-card p-4 sm:p-6">
              {visibleFields(section, answers).map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={answers[f.key]}
                  scope={answers}
                  error={showErrors ? errors[f.key] : undefined}
                  prefillValue={f.prefillKey ? (prefill[f.prefillKey] as string) ?? undefined : undefined}
                  onChange={(v) => setValue(f.key, v)}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-6">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground">Last step</p>
              <h1 className="text-2xl font-semibold tracking-tight">Review and submit</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                About {totalEstimatedMinutes()} minutes of answers. Check anything still outstanding below.
              </p>
            </div>

            <div className="space-y-2 rounded-xl border border-border bg-card p-4">
              {SECTIONS.map((s, i) => {
                const done = sectionComplete(s, answers);
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStep(i)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span>{s.title}</span>
                    <span className={done ? "text-xs text-primary" : "text-xs text-destructive"}>
                      {done ? "Complete" : s.required ? "Needs attention" : "Optional — empty"}
                    </span>
                  </button>
                );
              })}
            </div>

            {outstanding.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
                <p className="font-medium">Finish these before submitting:</p>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {outstanding.map((s) => (
                    <li key={s.key}>{s.title}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button className="w-full" size="lg" disabled={outstanding.length > 0 || submitting} onClick={submit}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Submit questionnaire
            </Button>
          </section>
        )}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 0}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Back
          </Button>
          {step < REVIEW_INDEX && (
            <Button onClick={goNext}>
              Continue <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
