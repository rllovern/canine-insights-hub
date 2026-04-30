import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell } from "@/components/layout/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const INVITE_CODE = "ridgeside-internal-2026";

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim() !== INVITE_CODE) {
      toast.error("Invalid invite code. Internal access requires a valid code.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    // Insert internal role for the new user
    if (data.user) {
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: data.user.id, role: "internal" });
      if (roleErr) {
        console.error(roleErr);
        toast.error("Account created, but failed to assign internal role. Contact admin.");
      }
    }

    setLoading(false);
    toast.success("Account created. Welcome!");
    navigate("/dashboard");
  };

  return (
    <AuthShell title="Create account" subtitle="Internal users only — invite code required.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Invite code</Label>
          <Input
            id="code"
            placeholder="ridgeside-internal-…"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">Min 8 characters. Common passwords are blocked.</p>
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating…" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}