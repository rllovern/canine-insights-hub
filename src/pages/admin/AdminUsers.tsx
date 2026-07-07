import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { Property, AppRole } from "@/lib/types";
import { EmptyState } from "@/components/data/EmptyState";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UserRow {
  user_id: string;
  role: AppRole;
}

interface AuthUser {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export default function AdminUsers() {
  const { user: me, role: myRole } = useAuth();
  const isSuperAdmin = myRole === "super_admin";
  const [roleRows, setRoleRows] = useState<UserRow[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [access, setAccess] = useState<{ user_id: string; property_id: string }[]>([]);
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ email: string; password: string; role: AppRole; property_id: string }>(
    { email: "", password: "", role: "location_owner", property_id: "" },
  );

  const load = async () => {
    setLoading(true);
    const [r, p, a, u] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("properties").select("*").order("name"),
      supabase.from("viewer_property_access").select("user_id, property_id"),
      isSuperAdmin
        ? supabase.functions.invoke("admin-users", { body: { action: "list" } })
        : Promise.resolve({ data: { users: [] as AuthUser[] }, error: null }),
    ]);
    setRoleRows((r.data ?? []) as UserRow[]);
    setProperties((p.data ?? []) as Property[]);
    setAccess(a.data ?? []);
    const listed = (u as { data?: { users?: AuthUser[] } | null }).data?.users ?? [];
    setAuthUsers(listed);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const emailFor = (userId: string) =>
    authUsers.find((u) => u.id === userId)?.email ?? null;

  const staff = roleRows.filter((r) => r.role === "super_admin" || r.role === "admin");
  const owners = roleRows.filter((r) => r.role === "owner");
  const locationOwners = roleRows.filter((r) => r.role === "location_owner");
  const roleLabel: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    owner: "Owner",
    location_owner: "Location Owner",
  };

  const assignLocationOwner = async (user_id: string, property_id: string) => {
    // Location Owners get exactly one assigned property. Wipe existing rows
    // for this user then insert the new pick.
    const del = await supabase.from("viewer_property_access").delete().eq("user_id", user_id);
    if (del.error) { toast.error(del.error.message); return; }
    const ins = await supabase.from("viewer_property_access").insert({ user_id, property_id });
    if (ins.error) { toast.error(ins.error.message); return; }
    toast.success("Assigned location updated");
    load();
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    if (!form.email || !form.password) {
      toast.error("Email and password are required");
      return;
    }
    if (form.role === "location_owner" && !form.property_id) {
      toast.error("Pick an assigned location for a Location Owner");
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: {
        action: "create",
        email: form.email,
        password: form.password,
        role: form.role,
        property_id: form.role === "location_owner" ? form.property_id : null,
      },
    });
    setCreating(false);
    const err = error?.message ?? (data as { error?: string } | null)?.error;
    if (err) { toast.error(err); return; }
    toast.success("User created");
    setForm({ email: "", password: "", role: "location_owner", property_id: "" });
    load();
  };

  const renderIdentity = (userId: string) => {
    const email = emailFor(userId);
    return (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{email ?? "(email unavailable)"}</div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">{userId}</div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <PageHeader
        title="Users"
        description="Super Admin and Admin manage the app. Owners see every location. Location Owners see only their assigned property."
      />

      {isSuperAdmin && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Add a user</h2>
          <form
            onSubmit={createUser}
            className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto]"
          >
            <div className="space-y-1">
              <Label htmlFor="new-email" className="text-xs">Email</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-password" className="text-xs">Temporary password</Label>
              <Input
                id="new-password"
                type="text"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min 8 characters"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as AppRole }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="location_owner">Location Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {form.role === "location_owner" ? "Assigned location" : "Location (n/a)"}
              </Label>
              <Select
                value={form.property_id}
                onValueChange={(v) => setForm((f) => ({ ...f, property_id: v }))}
                disabled={form.role !== "location_owner"}
              >
                <SelectTrigger>
                  <SelectValue placeholder={form.role === "location_owner" ? "Choose a location…" : "—"} />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={creating} className="w-full md:w-auto">
                {creating ? "Creating…" : "Add user"}
              </Button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            Share the temporary password with the user. They can change it later from their account settings.
          </p>
        </section>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Internal staff ({staff.length})</h2>
            {staff.length === 0 ? (
              <EmptyState title="No staff yet" description="Assign Super Admin or Admin roles here once other users sign up." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">
                  {staff.map((u) => (
                    <li key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      {renderIdentity(u.user_id)}
                      <span className="flex items-center gap-2 text-[11px]">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 font-semibold text-foreground">
                          {roleLabel[u.role] ?? u.role}
                        </span>
                        {u.user_id === me?.id && <span className="text-primary">you</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Owners ({owners.length})</h2>
            {owners.length === 0 ? (
              <EmptyState title="No owners yet" description="Owners get full read access to every location." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">
                  {owners.map((u) => (
                    <li key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      {renderIdentity(u.user_id)}
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Owner</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Location Owners ({locationOwners.length})</h2>
            {locationOwners.length === 0 ? (
              <EmptyState
                title="No location owners yet"
                description="Location Owner accounts must be created by a Super Admin. (Onboarding flow ships in a later phase.)"
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">
                  {locationOwners.map((u) => {
                    const assigned = access.find((a) => a.user_id === u.user_id);
                    return (
                      <li key={u.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 space-y-1">
                          {renderIdentity(u.user_id)}
                          {!assigned && (
                            <Badge variant="destructive" className="text-[10px]">Not assigned</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Assigned location</span>
                          <Select
                            value={assigned?.property_id ?? ""}
                            onValueChange={(v) => assignLocationOwner(u.user_id, v)}
                          >
                            <SelectTrigger className="h-8 w-[220px] text-xs">
                              <SelectValue placeholder="Choose a location…" />
                            </SelectTrigger>
                            <SelectContent>
                              {properties.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}