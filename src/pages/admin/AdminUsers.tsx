import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/data/PageHeader";
import { Property, AppRole } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/data/EmptyState";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

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

  const internals = roleRows.filter((r) => r.role === "internal");
  const viewers = roleRows.filter((r) => r.role === "viewer");

  const toggleAccess = async (user_id: string, property_id: string, on: boolean) => {
    if (on) {
      const { error } = await supabase.from("viewer_property_access").insert({ user_id, property_id });
      if (error) {
        toast.error(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("viewer_property_access")
        .delete()
        .eq("user_id", user_id)
        .eq("property_id", property_id);
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <PageHeader
        title="Users"
        description="Internal teammates have full access. Viewers see only their assigned properties."
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card/40" />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Internal users ({internals.length})</h2>
            {internals.length === 0 ? (
              <EmptyState title="No internal users" description="Share the invite code so teammates can self-register." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">
                  {internals.map((u) => (
                    <li key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{u.user_id}</span>
                      {u.user_id === me?.id && <span className="text-[11px] text-primary">you</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Viewers ({viewers.length})</h2>
            {viewers.length === 0 ? (
              <EmptyState
                title="No viewers yet"
                description="Viewer accounts must be created by an internal user. (Onboarding flow ships in a later phase.)"
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">
                  {viewers.map((u) => (
                    <li key={u.user_id} className="px-4 py-3">
                      <div className="mb-2 font-mono text-xs text-muted-foreground">{u.user_id}</div>
                      <div className="flex flex-wrap gap-3">
                        {properties.map((p) => {
                          const checked = access.some((a) => a.user_id === u.user_id && a.property_id === p.id);
                          return (
                            <label key={p.id} className="inline-flex items-center gap-1.5 text-xs">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleAccess(u.user_id, p.id, !!v)}
                              />
                              {p.name}
                            </label>
                          );
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}