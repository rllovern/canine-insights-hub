import { ReactNode } from "react";
import { Outlet, NavLink, useNavigate, useParams } from "react-router-dom";
import {
  BarChart3,
  PhoneCall,
  Globe,
  Sparkles,
  FileText,
  Settings,
  LogOut,
  LayoutGrid,
  Users,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/BrandMark";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";
import { PropertySwitcher } from "./PropertySwitcher";
import { ModeBadge } from "./ModeBadge";
import { DateRangePicker } from "./DateRangePicker";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { useProperties } from "@/contexts/PropertyContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface NavItem {
  label: string;
  to: string;
  icon: typeof BarChart3;
  internalOnly?: boolean;
}

function buildAnalyticsNav(slug?: string): NavItem[] {
  const base = slug ? `/properties/${slug}` : "/dashboard";
  return [
    { label: "PPC Overview", to: `${base}#ppc`, icon: BarChart3 },
    { label: "Call Tracking", to: `${base}#calls`, icon: PhoneCall },
    { label: "Web Analytics", to: `${base}#web`, icon: Globe },
  ];
}

function SidebarLink({
  to,
  icon: Icon,
  children,
  end,
}: {
  to: string;
  icon: typeof BarChart3;
  children: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-primary-muted text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
      {children}
    </div>
  );
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const { effectiveRole } = usePreviewMode();
  const { properties } = useProperties();
  const navigate = useNavigate();
  const { slug } = useParams();

  const activeProperty = properties.find((p) => p.slug === slug) ?? null;
  const analyticsNav = buildAnalyticsNav(slug);
  const isInternal = effectiveRole === "internal";

  const userInitials =
    user?.email?.split("@")[0]?.slice(0, 2)?.toUpperCase() ?? "U";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="border-b border-border p-3">
          <PropertySwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          <SectionLabel>Workspace</SectionLabel>
          <SidebarLink to="/dashboard" icon={LayoutGrid} end>
            All properties
          </SidebarLink>

          {activeProperty && (
            <>
              <SectionLabel>Analytics · {activeProperty.name.replace(/^.+—\s*/, "")}</SectionLabel>
              <SidebarLink to={`/properties/${activeProperty.slug}`} icon={BarChart3} end>
                Overview
              </SidebarLink>
              {analyticsNav.map((item) => (
                <SidebarLink key={item.to} to={item.to} icon={item.icon}>
                  {item.label}
                </SidebarLink>
              ))}
            </>
          )}

          <SectionLabel>Tools</SectionLabel>
          <SidebarLink to="/assistant" icon={Sparkles}>
            AI Assistant
          </SidebarLink>
          <SidebarLink to="/reports" icon={FileText}>
            Reports
          </SidebarLink>

          {isInternal && (
            <>
              <SectionLabel>Admin</SectionLabel>
              <SidebarLink to="/admin/properties" icon={Building2}>
                Properties
              </SidebarLink>
              <SidebarLink to="/admin/users" icon={Users}>
                Users
              </SidebarLink>
            </>
          )}
        </nav>

        {isInternal && (
          <div className="border-t border-border p-2">
            <SidebarLink to="/admin/settings" icon={Settings}>
              Settings
            </SidebarLink>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card/40 px-4">
          <BrandMark />
          {activeProperty && (
            <>
              <div className="h-5 w-px bg-border" />
              <button
                onClick={() => navigate(`/properties/${activeProperty.slug}`)}
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary"
              >
                <PropertyAvatar property={activeProperty} size="sm" />
                <span className="truncate">{activeProperty.name}</span>
              </button>
            </>
          )}

          <div className="ml-auto flex items-center gap-3">
            <DateRangePicker />
            <ModeBadge />

            <DropdownMenu>
              <DropdownMenuTrigger className="outline-none">
                <Avatar className="h-8 w-8 ring-1 ring-border">
                  <AvatarFallback className="bg-primary-muted text-xs font-semibold text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-xs font-medium">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await signOut();
                    navigate("/login");
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}