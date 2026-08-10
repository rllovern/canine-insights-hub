import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

const LABELS = ["Too weak", "Weak", "Okay", "Strong", "Excellent"];

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, refreshSecurity, clearMustChangePassword, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const score = strength(password);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("set-own-password", { body: { password } });
      const payload = data as { ok?: boolean; error?: string } | null;
      const err = payload?.error ?? (error ? error.message : null);
      if (err || !payload?.ok) {
        setLoading(false);
        toast.error(err || "Could not update your password. Please try again.");
        return;
      }

      // The password change can invalidate the current access token, so re-establish
      // a session with the new credentials before continuing.
      const email = user?.email;
      if (email) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          setLoading(false);
          toast.success("Password updated — please sign in with your new password");
          await signOut();
          navigate("/login", { replace: true });
          return;
        }
      }

      clearMustChangePassword();
      await refreshSecurity();
      toast.success("Password updated");
      // Hard navigation guarantees the guarded routes re-evaluate with fresh state.
      window.location.replace("/command");
    } catch (e) {
      setLoading(false);
      toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <AuthShell
      title="Set your password"
      subtitle="Choose a password only you know before continuing to the dashboard."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && (
            <div className="space-y-1 pt-1">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < score ? "bg-primary" : "bg-muted"}`}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{LABELS[score]} — minimum 8 characters</p>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm && confirm !== password && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Saving…" : "Save password and continue"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={async () => { await signOut(); navigate("/login", { replace: true }); }}
        >
          Sign out
        </Button>
      </form>
    </AuthShell>
  );
}
