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

interface UserRow {
  user_id: string;
  role: AppRole;
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [roleRows, setRoleRows] = useState<UserRow[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [access, setAccess] = useState<{ user_id: string; property_id: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [r, p, a] = await Promise.all([
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("properties").select("*").order("name"),
      supabase.from("viewer_property_access").select("user_id, property_id"),
    ]);
    setRoleRows((r.data ?? []) as UserRow[]);
    setProperties((p.data ?? []) as Property[]);
    setAccess(a.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <PageHeader
        title="Users"
        description="Super Admin and Admin manage the app. Owners see every location. Location Owners see only their assigned property."
      />

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
                      <span className="font-mono text-xs text-muted-foreground">{u.user_id}</span>
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
                      <span className="font-mono text-xs text-muted-foreground">{u.user_id}</span>
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
                          <div className="font-mono text-xs text-muted-foreground truncate">{u.user_id}</div>
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