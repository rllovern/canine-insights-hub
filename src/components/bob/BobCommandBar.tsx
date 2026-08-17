import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Sparkles, BarChart3, PhoneCall, FileText, Target, GitCompare, Search } from "lucide-react";
import { useBob } from "@/contexts/BobContext";

const QUICK = [
  { label: "Why are my leads down?", q: "Why are my leads down this month?" },
  { label: "Is my ad spend working?", q: "Is my ad spend working right now?" },
  { label: "How am I doing vs last year?", q: "How does this period compare to the same time last year?" },
  { label: "Anything I should worry about?", q: "Is there anything in my account I should be worried about right now?" },
];

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

export default BobCommandBar;