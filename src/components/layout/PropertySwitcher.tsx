import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useProperties } from "@/contexts/PropertyContext";
import { usePreviewMode } from "@/contexts/PreviewModeContext";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";

export function PropertySwitcher() {
  const navigate = useNavigate();
  const { slug } = useParams();
  const { properties, loading } = useProperties();
  const { isStaff } = usePreviewMode();
  const [open, setOpen] = useState(false);

  const active = properties.find((p) => p.slug === slug) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-12 w-full justify-between gap-2 bg-card px-2 text-left"
        >
          {active ? (
            <div className="flex min-w-0 items-center gap-2">
              <PropertyAvatar property={active} size="md" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-tight">{active.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{active.slug}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="grid h-9 w-9 place-items-center rounded-md bg-muted text-xs font-semibold">
                RC
              </div>
              <span>{loading ? "Loading…" : "Select property"}</span>
            </div>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Search properties…" />
          <CommandList>
            <CommandEmpty>No properties found.</CommandEmpty>
            <CommandGroup heading="Properties">
              {properties.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    setOpen(false);
                    navigate(`/properties/${p.slug}`);
                  }}
                  className="gap-2"
                >
                  <PropertyAvatar property={p} size="sm" />
                  <span className="flex-1 truncate">{p.name}</span>
                  <Check
                    className={cn(
                      "h-4 w-4",
                      active?.id === p.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {isStaff && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      navigate("/admin/properties");
                    }}
                    className="gap-2 text-sm text-muted-foreground"
                  >
                    <Plus className="h-4 w-4" />
                    Manage properties
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}