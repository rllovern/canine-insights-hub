import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Sparkles, BarChart3, PhoneCall, FileText, Target, GitCompare, Search } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { useDashboard } from "@/contexts/DashboardContext";
import { rangeToISO } from "@/lib/metrics";

const QUICK = [
  { label: "Reconcile CTM to GHL (last 14 days)", q: "Reconcile CTM calls against GHL for the last 14 days" },
  { label: "What's wrong with this account?", q: "What's wrong with this account right now?" },
  { label: "Account stability summary", q: "Summarize current account stability" },
  { label: "Lead performance snapshot", q: "Give me a lead performance snapshot" },
];

const NAV = [
  { label: "PPC Overview", to: "/dashboard", icon: BarChart3 },
  { label: "Call Tracking", to: "/calls", icon: PhoneCall },
  { label: "Lead Performance", to: "/lead-performance", icon: Target },
  { label: "Reports", to: "/reports", icon: FileText },
  { label: "Jarvis (Assistant)", to: "/assistant", icon: Sparkles },
];

export function JarvisCommandBar() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { activeProperty } = useScope();
  const { range } = useDashboard();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const ask = (q: string) => {
    setOpen(false);
    const sp = new URLSearchParams();
    sp.set("q", q);
    if (activeProperty?.id) sp.set("propertyId", activeProperty.id);
    if (range) {
      try {
        const iso = rangeToISO(range);
        sp.set("from", iso.from);
        sp.set("to", iso.to);
      } catch { /* noop */ }
    }
    nav(`/assistant?${sp.toString()}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Ask Jarvis or jump to a page…  (⌘K)" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Ask Jarvis">
          {QUICK.map((q) => (
            <CommandItem key={q.label} onSelect={() => ask(q.q)}>
              <Sparkles className="size-4 mr-2 text-primary" /> {q.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigate">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <CommandItem key={n.to} onSelect={() => { setOpen(false); nav(n.to); }}>
                <Icon className="size-4 mr-2 text-muted-foreground" /> {n.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default JarvisCommandBar;