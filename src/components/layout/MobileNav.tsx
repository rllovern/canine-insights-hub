import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Menu, Settings, LogOut, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/brand/BrandMark";
import { ScopeSelector } from "./ScopeSelector";
import { SourceHealthPanel } from "./SourceHealthPanel";
import {
  ADMIN_ITEMS,
  BUDGET_ITEM,
  COMMAND_ITEM,
  DELIVER_ITEMS,
  BOB_ITEM,
  MONITOR_ITEMS,
  SALES_ITEM,
  applyNavOrder,
  filterVisibleItems,
  type NavItem,
} from "./navItems";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const { signOut, user } = useAuth();
  const { effectiveRole, isStaff, isSuperAdmin, isLocationOwner } = usePreviewMode();
  const loc = useLocation();
  const nav = useNavigate();

  // Safety: clear any stray modal pointer-events lock left behind on close.
  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => {
        if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
      }, 400);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const initials = (user?.email ?? "U").slice(0, 2).toUpperCase();

  const isMinimal = isLocationOwner || effectiveRole === "owner";
  const showRichNav = isStaff && !isMinimal;
  const showAdminSection = isStaff && !isMinimal;

  const visible = (items: NavItem[], groupKey: string) =>
    applyNavOrder(groupKey, filterVisibleItems(items, { isStaff, isSuperAdmin }));

  const monitorItems = visible(MONITOR_ITEMS, "monitor");
  const deliverItems = visible(DELIVER_ITEMS, "deliver");
  const adminItems = visible(ADMIN_ITEMS, "admin");

  const adminActive = adminItems.some((i) => loc.pathname === i.to);
  const [adminOpen, setAdminOpen] = useState(adminActive);

  const isActive = (it: NavItem) =>
    loc.pathname === it.to || (it.to === "/dashboard" && loc.pathname === "/");

  const renderItem = (it: NavItem, indent = false) => {
    const Icon = it.icon;
    const active = isActive(it);
    const cls = cn(
      "group/nav flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
      indent && "pl-8",
      active ? "bg-white/[0.08] text-white" : "text-white/85 hover:bg-white/[0.04] hover:text-white",
    );
    const inner = (
      <>
        <Icon className={cn("size-4 shrink-0", active ? "text-white" : "text-white/70")} />
        <span className="truncate">{it.label}</span>
      </>
    );
    if (it.external) {
      return (
        <a key={it.key} href={it.to} target="_blank" rel="noopener" className={cls} onClick={() => setOpen(false)}>
          {inner}
        </a>
      );
    }
    return (
      <NavLink key={it.key} to={it.to} className={cls} onClick={() => setOpen(false)}>
        {inner}
      </NavLink>
    );
  };

  const GroupLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
      {children}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden shrink-0" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        ref={setContentEl}
        side="left"
        className="w-[280px] p-0 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col"
      >
        <div className="px-4 py-3 border-b border-sidebar-border">
          <BrandMark variant="onDark" />
        </div>
        <div className="px-3 pt-3">
          <ScopeSelector container={contentEl} onScopeChange={() => setOpen(false)} />
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          <GroupLabel>Executive View</GroupLabel>
          {renderItem(COMMAND_ITEM)}
          {isMinimal && renderItem(BUDGET_ITEM)}
          {renderItem(SALES_ITEM)}

          {showRichNav && monitorItems.length > 0 && (
            <>
              <GroupLabel>Monitor</GroupLabel>
              {renderItem(BUDGET_ITEM)}
              {monitorItems.map((it) => renderItem(it))}
            </>
          )}

          {showRichNav && deliverItems.length > 0 && (
            <>
              <GroupLabel>Deliver</GroupLabel>
              {deliverItems.map((it) => renderItem(it))}
            </>
          )}

          {showRichNav && renderItem(BOB_ITEM)}

          {showAdminSection && adminItems.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setAdminOpen((v) => !v)}
                aria-expanded={adminOpen}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-white/85 hover:bg-white/[0.04] hover:text-white transition-colors"
              >
                <Settings className="size-4 text-white/70" />
                <span className="flex-1 truncate text-left">Admin</span>
                <ChevronDown className={cn("size-4 text-white/45 transition-transform", adminOpen && "rotate-180")} />
              </button>
              {adminOpen && <div className="space-y-0.5">{adminItems.map((it) => renderItem(it, true))}</div>}
            </>
          )}
        </nav>
        <div className="px-2 pb-3 space-y-2">
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
              onClick={async () => { setOpen(false); await signOut(); nav("/login"); }}
              title="Sign out"
              className="grid h-7 w-7 place-items-center rounded-md text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
