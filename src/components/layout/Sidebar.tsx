import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch, Wallet, Target, GitBranch, Timer, Sparkles, LayoutDashboard, ChevronDown, Database, Sheet, Receipt } from "lucide-react";
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
  /** Show only to Super Admin + Admin (internal staff). */
  staffOnly?: boolean;
  /** Show only to Super Admin. */
  superAdminOnly?: boolean;
};

const COMMAND_ITEM: NavItem = { key: "command", to: "/command", label: "Command", icon: LayoutDashboard };

const BUDGET_ITEM: NavItem = { key: "budget", to: "/budget", label: "Budget Pacing", icon: Wallet };

const SALES_ITEM: NavItem = { key: "sales", to: "/sales", label: "Sale Records", icon: Receipt };

const MONITOR_ITEMS: NavItem[] = [
  { key: "dashboard", to: "/dashboard", label: "PPC Overview", icon: BarChart3 },
  { key: "calls", to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { key: "lead-performance", to: "/lead-performance", label: "Lead Performance", icon: Target },
];

const DELIVER_ITEMS: NavItem[] = [
  { key: "client-reports", to: "/admin/client-reports", label: "Performance Reports", icon: FileSearch, staffOnly: true, external: true },
  { key: "reports", to: "/reports", label: "Reports", icon: FileText },
];

const JARVIS_ITEM: NavItem = { key: "jarvis", to: "/assistant", label: "Jarvis", icon: Sparkles };

const ADMIN_ITEMS: NavItem[] = [
  { key: "clients", to: "/admin/properties", label: "Clients", icon: Users, staffOnly: true },
  { key: "users", to: "/admin/users", label: "Users", icon: Users, superAdminOnly: true },
  { key: "pipeline-mapping", to: "/admin/pipeline-mapping", label: "Pipeline Mapping", icon: GitBranch, superAdminOnly: true },
  { key: "sla-settings", to: "/admin/sla-settings", label: "SLA Settings", icon: Timer, superAdminOnly: true },
  { key: "data-sources", to: "/admin/data-sources", label: "Data Sources", icon: Database, superAdminOnly: true },
  { key: "google-sheets", to: "/admin/google-sheets", label: "Google Sheets", icon: Sheet, superAdminOnly: true },
  { key: "settings", to: "/admin/settings", label: "Settings", icon: Settings, superAdminOnly: true },
];

export function Sidebar() {
  const { signOut, user } = useAuth();
  const { effectiveRole, isStaff, isSuperAdmin, isLocationOwner } = usePreviewMode();
  const nav = useNavigate();
  const loc = useLocation();
  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();
  // Owner and Location Owner get a stripped-down nav: Command + Budget Pacing only.
  const isMinimal = isLocationOwner || effectiveRole === "owner";
  // Admin group visible only to internal staff (Super Admin + Admin).
  const showAdminSection = isStaff && !isMinimal;
  // Full monitoring / deliver / jarvis groups only for internal staff.
  const showRichNav = isStaff && !isMinimal;

  const filterVisible = (items: NavItem[]) =>
    items.filter((i) => {
      if (i.superAdminOnly && !isSuperAdmin) return false;
      if (i.staffOnly && !isStaff) return false;
      return true;
    });

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
    startX: number;
    startY: number;
    started: boolean;
    itemKey: string;
    suppressClick: boolean;
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
      "group/nav relative flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
      opts?.indent && "pl-8",
      active
        ? "bg-white/[0.06] text-white"
        : "text-white/85 hover:bg-white/[0.04] hover:text-white",
      draggable && "touch-none select-none",
      isOver && "ring-1 ring-white/40",
      dragKey === it.key && "opacity-40",
    );

    const dragHandlers = draggable
      ? {
          onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
            if (e.button !== 0) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragCtxRef.current = {
              groupKey: opts!.groupKey!,
              items: opts!.items!,
              setItems: opts!.setItems!,
              startX: e.clientX,
              startY: e.clientY,
              started: false,
              itemKey: it.key,
              suppressClick: false,
            };
          },
          onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
            const ctx = dragCtxRef.current;
            if (!ctx || ctx.itemKey !== it.key) return;
            if (!ctx.started) {
              const dx = e.clientX - ctx.startX;
              const dy = e.clientY - ctx.startY;
              if (dx * dx + dy * dy < 25) return; // 5px threshold
              ctx.started = true;
              ctx.suppressClick = true;
              setDragKey(it.key);
              setOverKey(it.key);
            }
            const k = findKeyAtPoint(e.clientX, e.clientY, ctx.groupKey);
            if (k && k !== overKey) setOverKey(k);
          },
          onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
            const ctx = dragCtxRef.current;
            if (ctx && ctx.started) {
              const targetKey = findKeyAtPoint(e.clientX, e.clientY, ctx.groupKey) || overKey;
              if (targetKey && targetKey !== ctx.itemKey) {
                reorder(ctx.groupKey, ctx.items, ctx.setItems, ctx.itemKey, targetKey);
              }
            }
            setDragKey(null);
            setOverKey(null);
            // Keep ctx briefly so click handler can read suppressClick
            const wasStarted = !!ctx?.started;
            dragCtxRef.current = wasStarted ? { ...ctx!, started: false } : null;
          },
          onPointerCancel: () => {
            dragCtxRef.current = null;
            setDragKey(null);
            setOverKey(null);
          },
          onClick: (e: React.MouseEvent) => {
            const ctx = dragCtxRef.current;
            if (ctx?.suppressClick) {
              e.preventDefault();
              e.stopPropagation();
              dragCtxRef.current = null;
            }
          },
        }
      : {};

    const dragAttrs = draggable
      ? { "data-drag-group": opts!.groupKey, "data-drag-key": it.key }
      : {};

    const inner = (
      <>
        <Icon className={cn("size-4 shrink-0", active ? "text-white" : "text-white/70 group-hover/nav:text-white")} />
        <span className="truncate">{it.label}</span>
      </>
    );
    if (it.external) {
      return (
        <a
          key={it.key}
          href={it.to}
          target="_blank"
          rel="noopener"
          className={linkClass}
          draggable={false}
          {...dragAttrs}
          {...dragHandlers}
        >
          {inner}
        </a>
      );
    }
    return (
      <NavLink
        key={it.key}
        to={it.to}
        className={linkClass}
        draggable={false}
        {...dragAttrs}
        {...dragHandlers}
      >
        {inner}
      </NavLink>
    );
  };

  const GroupLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
      {children}
    </div>
  );

  return (
    <aside className="hidden md:flex flex-col w-[223px] shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-screen overflow-y-auto">
      <div className="px-4 py-3 border-b border-sidebar-border">
        <BrandMark variant="onDark" />
      </div>
      <div className="px-3 pt-2">
        <ScopeSelector />
      </div>
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        <GroupLabel>EXECUTIVE VIEW</GroupLabel>
        {renderItem(COMMAND_ITEM)}
        {isMinimal && renderItem(BUDGET_ITEM)}
        {renderItem(SALES_ITEM)}

        {showRichNav && monitorItems.length > 0 && (
          <>
            <GroupLabel>Monitor</GroupLabel>
            {renderItem(BUDGET_ITEM)}
            {monitorItems.map((it) => renderItem(it, { groupKey: "monitor", items: monitorItems, setItems: setMonitorItems }))}
          </>
        )}

        {showRichNav && deliverItems.length > 0 && (
          <>
            <GroupLabel>Deliver</GroupLabel>
            {deliverItems.map((it) => renderItem(it, { groupKey: "deliver", items: deliverItems, setItems: setDeliverItems }))}
          </>
        )}

        {showRichNav && renderItem(JARVIS_ITEM, { accent: true })}

        {showAdminSection && adminItems.length > 0 && (
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
              {effectiveRole === "super_admin" ? "Super Admin"
                : effectiveRole === "admin" ? "Admin"
                : effectiveRole === "owner" ? "Owner"
                : "Location Owner"}
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