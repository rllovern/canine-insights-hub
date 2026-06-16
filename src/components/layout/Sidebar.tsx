import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch, Wallet, Target, GitBranch, Timer, Sparkles, LayoutDashboard, ChevronDown, GripVertical } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/BrandMark";
import { ScopeSelector } from "./ScopeSelector";
import { SourceHealthPanel } from "./SourceHealthPanel";

type NavItem = {
  key: string;
  to: string;
  label: string;
  icon: typeof BarChart3;
  external?: boolean;
  internalOnly?: boolean;
};

const COMMAND_ITEM: NavItem = { key: "command", to: "/command", label: "Command", icon: LayoutDashboard };

const MONITOR_ITEMS: NavItem[] = [
  { key: "budget", to: "/budget", label: "Budget Pacing", icon: Wallet, internalOnly: true },
  { key: "dashboard", to: "/dashboard", label: "PPC Overview", icon: BarChart3 },
  { key: "calls", to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { key: "lead-performance", to: "/lead-performance", label: "Lead Performance", icon: Target },
];

const DELIVER_ITEMS: NavItem[] = [
  { key: "client-reports", to: "/admin/client-reports", label: "Performance Reports", icon: FileSearch, internalOnly: true, external: true },
  { key: "reports", to: "/reports", label: "Reports", icon: FileText },
];

const JARVIS_ITEM: NavItem = { key: "jarvis", to: "/assistant", label: "Jarvis", icon: Sparkles };

const ADMIN_ITEMS: NavItem[] = [
  { key: "clients", to: "/admin/properties", label: "Clients", icon: Users, internalOnly: true },
  { key: "users", to: "/admin/users", label: "Users", icon: Users, internalOnly: true },
  { key: "pipeline-mapping", to: "/admin/pipeline-mapping", label: "Pipeline Mapping", icon: GitBranch, internalOnly: true },
  { key: "sla-settings", to: "/admin/sla-settings", label: "SLA Settings", icon: Timer, internalOnly: true },
  { key: "settings", to: "/admin/settings", label: "Settings", icon: Settings, internalOnly: true },
];

export function Sidebar() {
  const { signOut, user } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const nav = useNavigate();
  const loc = useLocation();
  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();

  const filterVisible = (items: NavItem[]) =>
    items.filter((i) => !i.internalOnly || effectiveRole === "internal");

  const applyOrder = (groupKey: string, items: NavItem[]) => {
    try {
      const raw = localStorage.getItem(`nav-order:${groupKey}`);
      if (!raw) return items;
      const order: string[] = JSON.parse(raw);
      const map = new Map(items.map((i) => [i.key, i]));
      const ordered: NavItem[] = [];
      order.forEach((k) => { const it = map.get(k); if (it) { ordered.push(it); map.delete(k); } });
      return [...ordered, ...map.values()];
    } catch { return items; }
  };

  const [monitorItems, setMonitorItems] = useState<NavItem[]>(() => applyOrder("monitor", filterVisible(MONITOR_ITEMS)));
  const [deliverItems, setDeliverItems] = useState<NavItem[]>(() => applyOrder("deliver", filterVisible(DELIVER_ITEMS)));
  const [adminItems, setAdminItems] = useState<NavItem[]>(() => applyOrder("admin", filterVisible(ADMIN_ITEMS)));

  useEffect(() => { setMonitorItems(applyOrder("monitor", filterVisible(MONITOR_ITEMS))); }, [effectiveRole]);
  useEffect(() => { setDeliverItems(applyOrder("deliver", filterVisible(DELIVER_ITEMS))); }, [effectiveRole]);
  useEffect(() => { setAdminItems(applyOrder("admin", filterVisible(ADMIN_ITEMS))); }, [effectiveRole]);

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const dragCtxRef = useRef<{
    groupKey: string;
    items: NavItem[];
    setItems: (v: NavItem[]) => void;
  } | null>(null);

  const findKeyAtPoint = (x: number, y: number, groupKey: string): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const row = el.closest<HTMLElement>(`[data-drag-group="${groupKey}"]`);
    return row?.dataset.dragKey ?? null;
  };

  const reorder = (
    groupKey: string,
    items: NavItem[],
    setItems: (v: NavItem[]) => void,
    fromKey: string,
    toKey: string,
  ) => {
    if (fromKey === toKey) return;
    const from = items.findIndex((i) => i.key === fromKey);
    const to = items.findIndex((i) => i.key === toKey);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    try { localStorage.setItem(`nav-order:${groupKey}`, JSON.stringify(next.map((i) => i.key))); } catch {}
  };

  const adminActive = adminItems.some((i) => loc.pathname === i.to);
  const [adminOpen, setAdminOpen] = useState<boolean>(adminActive);

  const isActive = (it: NavItem) =>
    loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");

  const renderItem = (
    it: NavItem,
    opts?: {
      accent?: boolean;
      indent?: boolean;
      groupKey?: string;
      items?: NavItem[];
      setItems?: (v: NavItem[]) => void;
    },
  ) => {
    const Icon = it.icon;
    const active = isActive(it);
    const draggable = !!opts?.groupKey;
    const isOver = draggable && overKey === it.key && dragKey && dragKey !== it.key;
    const linkClass = cn(
      "group/nav relative flex items-center gap-2 px-2 py-1.5 rounded-md text-xs font-medium transition-colors flex-1 min-w-0",
      opts?.indent && "pl-7",
      active
        ? "bg-white/[0.06] text-white"
        : "text-white/85 hover:bg-white/[0.04] hover:text-white",
    );
    const inner = (
      <>
        <Icon className={cn("size-4 shrink-0", active ? "text-white" : "text-white/70 group-hover/nav:text-white")} />
        <span className="truncate">{it.label}</span>
      </>
    );
    const link = it.external ? (
      <a href={it.to} target="_blank" rel="noopener" className={linkClass} draggable={false}>
        {inner}
      </a>
    ) : (
      <NavLink to={it.to} className={linkClass} draggable={false}>
        {inner}
      </NavLink>
    );

    if (!draggable) {
      return <div key={it.key}>{link}</div>;
    }

    return (
      <div
        key={it.key}
        data-drag-group={opts!.groupKey}
        data-drag-key={it.key}
        className={cn(
          "group/row relative flex items-center rounded-md",
          isOver && "ring-1 ring-white/50 bg-white/[0.03]",
          dragKey === it.key && "opacity-40",
        )}
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragCtxRef.current = {
              groupKey: opts!.groupKey!,
              items: opts!.items!,
              setItems: opts!.setItems!,
            };
            setDragKey(it.key);
            setOverKey(it.key);
          }}
          onPointerMove={(e) => {
            if (!dragCtxRef.current) return;
            const k = findKeyAtPoint(e.clientX, e.clientY, dragCtxRef.current.groupKey);
            if (k && k !== overKey) setOverKey(k);
          }}
          onPointerUp={(e) => {
            const ctx = dragCtxRef.current;
            if (ctx && dragKey) {
              const targetKey = findKeyAtPoint(e.clientX, e.clientY, ctx.groupKey) || overKey;
              if (targetKey && targetKey !== dragKey) {
                reorder(ctx.groupKey, ctx.items, ctx.setItems, dragKey, targetKey);
              }
            }
            dragCtxRef.current = null;
            setDragKey(null);
            setOverKey(null);
          }}
          onPointerCancel={() => {
            dragCtxRef.current = null;
            setDragKey(null);
            setOverKey(null);
          }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-white/40 transition-colors hover:text-white active:cursor-grabbing touch-none select-none"
        >
          <GripVertical className="size-3" />
        </button>
        {link}
      </div>
    );
  };

  const GroupLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
      {children}
    </div>
  );

  return (
    <aside className="hidden md:flex flex-col w-[223px] shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-3 border-b border-sidebar-border">
        <BrandMark variant="onDark" />
      </div>
      <div className="px-3 pt-2">
        <ScopeSelector />
      </div>
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        <GroupLabel>EXECUTIVE VIEW</GroupLabel>
        {renderItem(COMMAND_ITEM)}

        {monitorItems.length > 0 && (
          <>
            <GroupLabel>Monitor</GroupLabel>
            {monitorItems.map((it) => renderItem(it, { groupKey: "monitor", items: monitorItems, setItems: setMonitorItems }))}
          </>
        )}

        {deliverItems.length > 0 && (
          <>
            <GroupLabel>Deliver</GroupLabel>
            {deliverItems.map((it) => renderItem(it, { groupKey: "deliver", items: deliverItems, setItems: setDeliverItems }))}
          </>
        )}

        {renderItem(JARVIS_ITEM, { accent: true })}

        {adminItems.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setAdminOpen((v) => !v)}
              className={cn(
                "group/nav relative flex w-full items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                "text-white/85 hover:bg-white/[0.04] hover:text-white",
              )}
              aria-expanded={adminOpen}
            >
              <Settings className="size-4 text-white/70 group-hover/nav:text-white" />
              <span className="truncate flex-1 text-left">Admin</span>
              <ChevronDown className={cn("size-4 text-white/45 transition-transform", adminOpen && "rotate-180")} />
            </button>
            {adminOpen && (
              <div className="space-y-0.5">
                {adminItems.map((it) => renderItem(it, { indent: true, groupKey: "admin", items: adminItems, setItems: setAdminItems }))}
              </div>
            )}
          </>
        )}
      </nav>
      <div className="px-2 pb-2 space-y-2">
        <div className="border-t border-sidebar-border pt-2">
          <SourceHealthPanel />
        </div>
        <div className="mx-1 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate text-white">{user?.email ?? "Account"}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/50">
              {effectiveRole === "internal" ? "Administrator" : "Viewer"}
            </div>
          </div>
          <button
            onClick={async () => { await signOut(); nav("/login"); }}
            title="Sign out"
            className="grid h-7 w-7 place-items-center rounded-md text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}