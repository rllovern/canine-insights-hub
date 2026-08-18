import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { hadRecoveryPayloadAtLoad } from "@/lib/recoveryUrl";

function hasRecoveryPayload() {
  // The snapshot taken before the Supabase client booted is authoritative:
  // detectSessionInUrl strips the recovery params from the URL during module
  // init, long before this component mounts.
  if (hadRecoveryPayloadAtLoad()) return true;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  return Boolean(hash.get("access_token") || hash.get("token_hash") || search.get("code") || search.get("token_hash"));
}

// Invite links carry ?welcome=1 (set by admin-users) or type=invite from
// GoTrue. New users get welcome copy instead of "reset your password".
function isInviteLink() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(window.location.search);
  return (
    search.get("welcome") === "1" ||
    hash.get("type") === "invite" ||
    search.get("type") === "invite"
  );
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [invite] = useState(isInviteLink);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    // A reset link is single use: the form only unlocks when this page load
    // carries a fresh recovery payload in the URL. A leftover session is not
    // enough — a used link must send the person back to "Forgot password".
    if (!hasRecoveryPayload()) {
      setStatus("invalid");
      supabase.auth.signOut();
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setStatus("ready");
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? "ready" : "invalid");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const onResend = async () => {
    if (!resendEmail) { toast.error("Enter your email first"); return; }
    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resendEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResending(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Check your email for a new reset link");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    // set-own-password also clears the "must change password" flag so invited
    // users aren't bounced back here on their next sign-in.
    const { data, error } = await supabase.functions.invoke("set-own-password", {
      body: { password, from_recovery: true },
    });
    setLoading(false);
    const err = (data as { error?: string } | null)?.error ?? error?.message;
    if (err) { toast.error(err); return; }
    // Burn the recovery session so the same link can't be reused.
    await supabase.auth.signOut();
    toast.success(invite ? "Password set — sign in to continue" : "Password updated — sign in with your new password");
    navigate("/login", { replace: true });
  };

  return (
    <AuthShell
      title={
        status === "ready"
          ? invite
            ? "Welcome to RSK9 Insights"
            : "Choose a new password"
          : invite
            ? "Invitation link unavailable"
            : "Reset link unavailable"
      }
      subtitle={
        status === "ready"
          ? invite
            ? "Set a password to finish setting up your account. Inside you'll find your ad spend, lead quality, and sales performance in one place."
            : "Enter a new password for your account."
          : status === "checking"
            ? invite ? "Checking your invitation link…" : "Checking your reset link…"
            : "This link has already been used or has expired. Request a new one to continue."
      }
    >
      {status === "ready" ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">{invite ? "Password" : "New password"}</Label>
            <Input id="reset-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <Input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : invite ? "Set password" : "Update password"}
          </Button>
        </form>
      ) : status === "checking" ? null : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="resend-email">Email</Label>
            <Input id="resend-email" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} />
          </div>
          <Button className="w-full" onClick={onResend} disabled={resending}>
            {resending ? "Sending…" : "Send new reset link"}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>Back to sign in</Button>
        </div>
      )}
    </AuthShell>
  );
}
