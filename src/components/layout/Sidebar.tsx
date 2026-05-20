import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, Users, FileText, FileSearch } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { BrandMark } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "PPC Overview", icon: BarChart3 },
  { to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { to: "/reports", label: "Reports", icon: FileText },
];

export function Sidebar() {
  const { signOut, user } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const nav = useNavigate();
  const loc = useLocation();
  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 py-4 border-b border-sidebar-border">
        <BrandMark variant="onDark" />
        <div className="mt-2 h-[2px] w-10 rounded-full bg-sidebar-primary" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/55 font-semibold">Analytics</div>
        {navItems.map((it) => {
          const Icon = it.icon;
          const active = loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={cn(
                "relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary"
                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className={cn("size-4", active && "text-sidebar-primary")} />
              {it.label}
            </NavLink>
          );
        })}
        {effectiveRole === "internal" && (
          <>
            <div className="px-2 mt-5 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/55 font-semibold">Admin</div>
            <NavLink to="/admin/properties" className={({isActive}) => cn("relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
              <Users className="size-4" /> Clients
            </NavLink>
            <NavLink to="/admin/client-reports" className={({isActive}) => cn("relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
              <FileSearch className="size-4" /> Client Reports
            </NavLink>
            <NavLink to="/admin/users" className={({isActive}) => cn("relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
              <Users className="size-4" /> Users
            </NavLink>
            <NavLink to="/admin/settings" className={({isActive}) => cn("relative flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-sidebar-primary" : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
              <Settings className="size-4" /> Settings
            </NavLink>
          </>
        )}
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