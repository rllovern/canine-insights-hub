import { Link, NavLink, useLocation } from "react-router-dom";
import { BarChart3, PhoneCall, Settings, LogOut, CircleDot, Users, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "PPC Overview", icon: BarChart3 },
  { to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { to: "/keywords", label: "Keywords", icon: Search },
];

export function Sidebar() {
  const { effectiveRole: role, signOut, user } = useAuth();
  const loc = useLocation();
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-sidebar-border">
        <div className="size-8 rounded-lg bg-gradient-brand grid place-items-center shadow-md">
          <CircleDot className="size-4 text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-bold text-white tracking-tight">Ridgeside Canine</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/60">Dashboard</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">Analytics</div>
        {navItems.map((it) => {
          const Icon = it.icon;
          const active = loc.pathname === it.to;
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white"
              )}
            >
              <Icon className="size-4" />
              {it.label}
            </NavLink>
          );
        })}
        {role === "internal" && (
          <>
            <div className="px-2 mt-5 mb-2 text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">Admin</div>
            <NavLink
              to="/admin/properties"
              className={({ isActive }) => cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive ? "bg-sidebar-accent text-white" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white"
              )}
            >
              <Users className="size-4" /> Properties
            </NavLink>
            <NavLink
              to="/admin/settings"
              className={({ isActive }) => cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive ? "bg-sidebar-accent text-white" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-white"
              )}
            >
              <Settings className="size-4" /> Settings
            </NavLink>
          </>
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="px-2 py-2 text-xs text-sidebar-foreground/70 truncate">{user?.email}</div>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-colors"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
