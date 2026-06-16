import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch, Wallet, Target, GitBranch, Timer, Sparkles, LayoutDashboard, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { cn } from "@/lib/utils";
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
      "group/nav relative flex items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-md text-[13px] transition-colors",
      opts?.indent && "pl-8",
      active
        ? "text-sidebar-accent-foreground font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-r-full before:bg-foreground"
        : "font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    );
    const inner = (
      <>
        <Icon className={cn("size-4 shrink-0", opts?.accent ? "text-sidebar-primary" : active ? "text-sidebar-accent-foreground" : "text-sidebar-foreground/60")} />
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
    <div className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
      {children}
    </div>
  );

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-4 flex items-center gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
          R
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-sidebar-accent-foreground truncate leading-tight">Ridgeside K9</div>
          <div className="text-[11px] text-sidebar-foreground/55 truncate leading-tight">Acquisition Intelligence</div>
        </div>
      </div>
      <div className="px-3 pt-3">
        <ScopeSelector />
      </div>
      <nav className="flex-1 px-2 py-3 space-y-px overflow-y-auto">
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

        <div className="pt-3">
          {renderItem(JARVIS_ITEM, { accent: true })}
        </div>

        {adminItems.length > 0 && (
          <div className="pt-3">
            <button
              type="button"
              onClick={() => setAdminOpen((v) => !v)}
              className={cn(
                "group/nav relative flex w-full items-center gap-2.5 pl-3 pr-3 py-1.5 rounded-md text-[13px] font-medium transition-colors",
                "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
              aria-expanded={adminOpen}
            >
              <Settings className="size-4 text-sidebar-foreground/60" />
              <span className="truncate flex-1 text-left">Admin</span>
              <ChevronDown className={cn("size-3.5 transition-transform", adminOpen && "rotate-180")} />
            </button>
            {adminOpen && (
              <div className="mt-0.5 space-y-0.5">
                {adminItems.map((it) => renderItem(it, { indent: true }))}
              </div>
            )}
          </div>
        )}
      </nav>
      <div className="px-2 pb-3 space-y-3">
        <div className="border-t border-sidebar-border pt-3">
          <SourceHealthPanel />
        </div>
        <div className="mx-1 flex items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 py-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-[11px] font-semibold text-sidebar-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium truncate text-sidebar-accent-foreground">{user?.email ?? "Account"}</div>
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