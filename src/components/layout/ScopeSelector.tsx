import { Check, ChevronsUpDown, Building2, Globe2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useScope } from "@/contexts/ScopeContext";
import { useProperties } from "@/contexts/PropertyContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { cn } from "@/lib/utils";

export function ScopeSelector() {
  const { mode, propertyId, setScope, label } = useScope();
  const { properties } = useProperties();
  const { effectiveRole } = usePreviewMode();
  const [open, setOpen] = useState(false);

  const agencyLabel = effectiveRole === "internal" ? "All locations" : "All my properties";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="w-full h-9 justify-between rounded-md border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 text-left text-xs font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <span className="flex items-center gap-2 min-w-0">
            {mode === "agency" ? <Globe2 className="size-3.5 shrink-0 text-sidebar-primary" /> : <Building2 className="size-3.5 shrink-0 text-sidebar-primary" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 p-0 z-50 bg-popover">
        <Command>
          <CommandInput placeholder="Search location…" className="h-9" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Scope">
              <CommandItem
                value="__agency__"
                onSelect={() => { setScope({ mode: "agency" }); setOpen(false); }}
              >
                <Globe2 className="size-3.5 mr-2 text-primary" />
                <span>{agencyLabel}</span>
                <Check className={cn("ml-auto size-3.5", mode === "agency" ? "opacity-100" : "opacity-0")} />
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Locations">
              {properties.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.slug}`}
                  onSelect={() => { setScope({ mode: "property", propertyId: p.id }); setOpen(false); }}
                >
                  <Building2 className="size-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                  <Check className={cn("ml-auto size-3.5", mode === "property" && propertyId === p.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}