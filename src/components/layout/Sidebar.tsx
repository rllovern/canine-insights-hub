import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch, Wallet, Target, GitBranch, Timer, Sparkles, LayoutDashboard, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
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
  { key: "client-reports", to: "/admin/client-reports", label: "Client Reports", icon: FileSearch, internalOnly: true, external: true },
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

  const monitorItems = useMemo(() => filterVisible(MONITOR_ITEMS), [effectiveRole]);
  const deliverItems = useMemo(() => filterVisible(DELIVER_ITEMS), [effectiveRole]);
  const adminItems = useMemo(() => filterVisible(ADMIN_ITEMS), [effectiveRole]);

  const adminActive = adminItems.some((i) => loc.pathname === i.to);
  const [adminOpen, setAdminOpen] = useState<boolean>(adminActive);

  const isActive = (it: NavItem) =>
    loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");

  const renderItem = (it: NavItem, opts?: { accent?: boolean; indent?: boolean }) => {
    const Icon = it.icon;
    const active = isActive(it);
    const linkClass = cn(
      "group/nav relative flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
      opts?.indent && "pl-8",
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
    if (it.external) {
      return (
        <a key={it.key} href={it.to} target="_blank" rel="noopener" className={linkClass}>
          {inner}
        </a>
      );
    }
    return (
      <NavLink key={it.key} to={it.to} className={linkClass}>
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
    <aside className="hidden md:flex flex-col w-52 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-3 border-b border-sidebar-border">
        <BrandMark variant="onDark" />
      </div>
      <div className="px-3 pt-2">
        <ScopeSelector />
      </div>
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
        <GroupLabel>Reporting</GroupLabel>
        {renderItem(COMMAND_ITEM)}

        {monitorItems.length > 0 && (
          <>
            <GroupLabel>Monitor</GroupLabel>
            {monitorItems.map((it) => renderItem(it))}
          </>
        )}

        {deliverItems.length > 0 && (
          <>
            <GroupLabel>Deliver</GroupLabel>
            {deliverItems.map((it) => renderItem(it))}
          </>
        )}

        <div className="pt-1">
          {renderItem(JARVIS_ITEM, { accent: true })}
        </div>

        {adminItems.length > 0 && (
          <div className="pt-1">
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
              <div className="mt-0.5 space-y-0.5">
                {adminItems.map((it) => renderItem(it, { indent: true }))}
              </div>
            )}
          </div>
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