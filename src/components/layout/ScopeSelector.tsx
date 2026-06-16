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
          className="w-full h-auto py-2 px-3 justify-between rounded-md bg-white/[0.05] text-left text-[14px] font-medium text-white/85 hover:bg-white/[0.08] hover:text-white"
        >
          <span className="flex items-center gap-2 min-w-0">
            {mode === "agency" ? <Globe2 className="size-4 shrink-0 text-white/70" /> : <Building2 className="size-4 shrink-0 text-white/70" />}
            <span className="truncate">{label}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-white/45" />
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