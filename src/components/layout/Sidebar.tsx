import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch, Wallet, GripVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { BrandMark } from "@/components/brand/BrandMark";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  to: string;
  label: string;
  icon: typeof BarChart3;
  external?: boolean;
  internalOnly?: boolean;
};

const ALL_ITEMS: NavItem[] = [
  { key: "dashboard", to: "/dashboard", label: "PPC Overview", icon: BarChart3 },
  { key: "calls", to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { key: "reports", to: "/reports", label: "Reports", icon: FileText },
  { key: "budget", to: "/budget", label: "Budget Pacing", icon: Wallet, internalOnly: true },
  { key: "clients", to: "/admin/properties", label: "Clients", icon: Users, internalOnly: true },
  { key: "client-reports", to: "/admin/client-reports", label: "Client Reports", icon: FileSearch, internalOnly: true, external: true },
  { key: "users", to: "/admin/users", label: "Users", icon: Users, internalOnly: true },
  { key: "settings", to: "/admin/settings", label: "Settings", icon: Settings, internalOnly: true },
];
const DEFAULT_ORDER = ALL_ITEMS.map((i) => i.key);

export function Sidebar() {
  const { signOut, user } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const nav = useNavigate();
  const loc = useLocation();
  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();

  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("user_nav_preferences")
        .select("order_keys")
        .eq("user_id", user.id)
        .maybeSingle();
      const saved = (data?.order_keys as string[] | undefined) ?? [];
      // Merge: saved order first (only known keys), then any new defaults appended.
      const merged = [
        ...saved.filter((k) => DEFAULT_ORDER.includes(k)),
        ...DEFAULT_ORDER.filter((k) => !saved.includes(k)),
      ];
      setOrder(merged);
    })();
  }, [user]);

  const persist = async (next: string[]) => {
    if (!user) return;
    setOrder(next);
    await supabase.from("user_nav_preferences").upsert(
      { user_id: user.id, order_keys: next, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  };

  const itemMap = useMemo(() => new Map(ALL_ITEMS.map((i) => [i.key, i])), []);
  const visibleItems = useMemo(
    () => order
      .map((k) => itemMap.get(k))
      .filter((i): i is NavItem => !!i && (!i.internalOnly || effectiveRole === "internal")),
    [order, itemMap, effectiveRole],
  );

  const onDrop = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); setOverKey(null); return; }
    const next = order.filter((k) => k !== dragKey);
    const idx = next.indexOf(targetKey);
    next.splice(idx, 0, dragKey);
    setDragKey(null);
    setOverKey(null);
    persist(next);
  };

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-4 border-b border-sidebar-border">
        <BrandMark variant="onDark" />
        <div className="mt-2 h-[2px] w-10 rounded-full bg-sidebar-primary" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((it) => {
          const Icon = it.icon;
          const active = loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");
          const isDragging = dragKey === it.key;
          const showIndicator = overKey === it.key && dragKey && dragKey !== it.key;
          const linkClass = cn(
            "group/nav relative flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-md text-sm font-medium transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary"
              : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            isDragging && "opacity-40",
          );
          const inner = (
            <>
              <GripVertical className="size-3.5 text-sidebar-foreground/35 opacity-0 group-hover/nav:opacity-100 transition-opacity -ml-0.5 cursor-grab active:cursor-grabbing" />
              <Icon className={cn("size-4", active && "text-sidebar-primary")} />
              <span className="truncate">{it.label}</span>
            </>
          );
          const dragProps = {
            draggable: true,
            onDragStart: (e: React.DragEvent) => {
              setDragKey(it.key);
              e.dataTransfer.effectAllowed = "move";
            },
            onDragOver: (e: React.DragEvent) => {
              if (!dragKey || dragKey === it.key) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOverKey(it.key);
            },
            onDragLeave: () => { if (overKey === it.key) setOverKey(null); },
            onDrop: (e: React.DragEvent) => { e.preventDefault(); onDrop(it.key); },
            onDragEnd: () => { setDragKey(null); setOverKey(null); },
          };
          return (
            <div key={it.key} className="relative">
              {showIndicator && <div className="absolute -top-px left-1 right-1 h-[2px] rounded-full bg-sidebar-primary" />}
              {it.external ? (
                <a href={it.to} target="_blank" rel="noopener" className={linkClass} {...dragProps}>
                  {inner}
                </a>
              ) : (
                <NavLink to={it.to} className={linkClass} {...dragProps}>
                  {inner}
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>
      <div className="px-3 pb-3 space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-sidebar-border/60 px-2.5 py-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[11px] font-semibold text-sidebar-primary">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate text-sidebar-foreground">{user?.email ?? "Account"}</div>
            <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/55">
              {effectiveRole === "internal" ? "Administrator" : "Viewer"}
            </div>
          </div>
          <button
            onClick={async () => { await signOut(); nav("/login"); }}
            title="Sign out"
            className="grid h-7 w-7 place-items-center rounded-md text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}