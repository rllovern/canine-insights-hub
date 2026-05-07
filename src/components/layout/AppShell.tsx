import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { BarChart3, Building2, MessageSquare, FileText, Settings, Users, LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { PropertySwitcher } from "./PropertySwitcher";
import { DateRangePicker } from "./DateRangePicker";
import { ModeBadge } from "./ModeBadge";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items = [
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { to: "/assistant", label: "Assistant", icon: MessageSquare },
  { to: "/reports", label: "Reports", icon: FileText },
];
const adminItems = [
  { to: "/admin/properties", label: "Properties", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { signOut, role } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="px-4 h-14 flex items-center border-b border-border"><BrandMark /></div>
        <div className="px-3 py-3 border-b border-border"><PropertySwitcher /></div>
        <nav className="flex-1 p-3 space-y-0.5 text-sm">
          {items.map(i => (
            <NavLink key={i.to} to={i.to} className={({isActive}) => cn("flex items-center gap-2 px-3 py-2 rounded-md", isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted")}>
              <i.icon className="h-4 w-4" /> {i.label}
            </NavLink>
          ))}
          {role === "internal" && (
            <>
              <div className="px-3 mt-4 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Admin</div>
              {adminItems.map(i => (
                <NavLink key={i.to} to={i.to} className={({isActive}) => cn("flex items-center gap-2 px-3 py-2 rounded-md", isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted")}>
                  <i.icon className="h-4 w-4" /> {i.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="p-3 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={async () => { await signOut(); nav("/login"); }}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card/40 px-4 flex items-center gap-3">
          <div className="ml-auto flex items-center gap-3">
            <DateRangePicker />
            <ModeBadge />
          </div>
        </header>
        <main className="flex-1 min-w-0"><Outlet /></main>
      </div>
    </div>
  );
}