import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Sparkles, BarChart3, PhoneCall, FileText, Target, GitCompare, Search } from "lucide-react";
import { useBob } from "@/contexts/BobContext";
import { useScope } from "@/contexts/ScopeContext";
import { buildQuickPrompts } from "./quickPrompts";

const NAV = [
  { label: "PPC Overview", to: "/dashboard", icon: BarChart3 },
  { label: "Call Tracking", to: "/calls", icon: PhoneCall },
  { label: "Lead Performance", to: "/lead-performance", icon: Target },
  { label: "Reports", to: "/reports", icon: FileText },
];

export function BobCommandBar() {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { openBob } = useBob();
  const { mode, activeProperty, label: scopeLabel } = useScope();
  const quick = buildQuickPrompts({
    placeLabel: mode === "property" ? activeProperty?.name ?? scopeLabel : "all locations",
  });

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
    openBob(q);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Ask Bob or jump to a page…  (⌘K)" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Ask Bob">
          {quick.map((q) => (
            <CommandItem key={q.id} onSelect={() => ask(q.question)}>
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

export default BobCommandBar;