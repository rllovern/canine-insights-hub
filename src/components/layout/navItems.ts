import { BarChart3, PhoneCall, Settings, Users, FileText, FileSearch, Wallet, Target, GitBranch, Timer, LayoutDashboard, Database, Receipt, MessageSquare } from "lucide-react";

export type NavItem = {
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

export const COMMAND_ITEM: NavItem = { key: "command", to: "/command", label: "Command", icon: LayoutDashboard };
export const BUDGET_ITEM: NavItem = { key: "budget", to: "/budget", label: "Budget Pacing", icon: Wallet };
export const SALES_ITEM: NavItem = { key: "sales", to: "/sales", label: "Sale Records", icon: Receipt };

export const MONITOR_ITEMS: NavItem[] = [
  { key: "dashboard", to: "/dashboard", label: "PPC Overview", icon: BarChart3 },
  { key: "calls", to: "/calls", label: "Call Tracking", icon: PhoneCall },
  { key: "lead-performance", to: "/lead-performance", label: "Lead Performance", icon: Target },
];

export const DELIVER_ITEMS: NavItem[] = [
  { key: "client-reports", to: "/admin/client-reports", label: "Performance Reports", icon: FileSearch, staffOnly: true, external: true },
  { key: "reports", to: "/reports", label: "Reports", icon: FileText },
];

export const ADMIN_ITEMS: NavItem[] = [
  { key: "clients", to: "/admin/properties", label: "Clients", icon: Users, staffOnly: true },
  { key: "users", to: "/admin/users", label: "Users", icon: Users, superAdminOnly: true },
  { key: "pipeline-mapping", to: "/admin/pipeline-mapping", label: "Pipeline Mapping", icon: GitBranch, superAdminOnly: true },
  { key: "sla-settings", to: "/admin/sla-settings", label: "SLA Settings", icon: Timer, superAdminOnly: true },
  { key: "data-sources", to: "/admin/data-sources", label: "Data Sources", icon: Database, superAdminOnly: true },
  { key: "bob-logs", to: "/admin/bob-logs", label: "Bob Logs", icon: MessageSquare, superAdminOnly: true },
  { key: "settings", to: "/admin/settings", label: "Settings", icon: Settings, superAdminOnly: true },
];

export function filterVisibleItems(
  items: NavItem[],
  opts: { isStaff: boolean; isSuperAdmin: boolean },
): NavItem[] {
  return items.filter((i) => {
    if (i.superAdminOnly && !opts.isSuperAdmin) return false;
    if (i.staffOnly && !opts.isStaff) return false;
    return true;
  });
}

/** Applies the user's persisted drag order for a nav group. */
export function applyNavOrder(groupKey: string, items: NavItem[]): NavItem[] {
  try {
    const raw = localStorage.getItem(`nav-order:${groupKey}`);
    if (!raw) return items;
    const order: string[] = JSON.parse(raw);
    const map = new Map(items.map((i) => [i.key, i]));
    const ordered: NavItem[] = [];
    order.forEach((k) => { const it = map.get(k); if (it) { ordered.push(it); map.delete(k); } });
    return [...ordered, ...map.values()];
  } catch { return items; }
}
