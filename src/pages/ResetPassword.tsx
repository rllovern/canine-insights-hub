import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => setReady(Boolean(session)));
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    // set-own-password also clears the "must change password" flag so invited
    // users aren't bounced back here on their next sign-in.
    const { data, error } = await supabase.functions.invoke("set-own-password", { body: { password } });
    setLoading(false);
    const err = error?.message ?? (data as { error?: string } | null)?.error;
    if (err) { toast.error(err); return; }
    toast.success("Password updated — you're signed in");
    navigate("/command", { replace: true });
  };

  return (
    <AuthShell
      title="Choose a new password"
      subtitle={ready ? "Enter a new password for your account." : "Open this page from the reset link in your email."}
    >
      {ready ? (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input id="reset-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-confirm">Confirm password</Label>
            <Input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Update password"}
          </Button>
        </form>
      ) : (
        <Button variant="outline" className="w-full" onClick={() => navigate("/login")}>Back to sign in</Button>
      )}
    </AuthShell>
  );
}
