import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, PhoneCall, Search, Settings, LogOut, Users, FileText } from "lucide-react";
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
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="px-4 h-16 flex items-center border-b border-sidebar-border">
        <BrandMark />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <div className="px-2 mb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Analytics</div>
        {navItems.map((it) => {
          const Icon = it.icon;
          const active = loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");
          return (
            <NavLink
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Icon className="size-4" />
              {it.label}
            </NavLink>
          );
        })}
        {effectiveRole === "internal" && (
          <>
            <div className="px-2 mt-5 mb-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Admin</div>
            <NavLink to="/admin/properties" className={({isActive}) => cn("flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent")}>
              <Users className="size-4" /> Clients
            </NavLink>
            <NavLink to="/admin/users" className={({isActive}) => cn("flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent")}>
              <Users className="size-4" /> Users
            </NavLink>
            <NavLink to="/admin/settings" className={({isActive}) => cn("flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors", isActive ? "bg-primary/10 text-primary" : "text-sidebar-foreground hover:bg-sidebar-accent")}>
              <Settings className="size-4" /> Settings
            </NavLink>
          </>
        )}
      </nav>
      <div className="p-3 border-t border-sidebar-border">
        <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user?.email}</div>
        <button
          onClick={async () => { await signOut(); nav("/login"); }}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-sidebar-accent transition-colors"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}