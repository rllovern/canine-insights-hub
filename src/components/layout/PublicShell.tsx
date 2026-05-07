import { ReactNode } from "react";
import { DateRangePicker } from "./DateRangePicker";
import { PropertyAvatar } from "@/components/brand/PropertyAvatar";
import { Property } from "@/lib/types";

export function PublicShell({ property, children }: { property: Property; children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="border-b border-border bg-card/40">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <PropertyAvatar property={property} size="lg" />
          <div className="flex flex-col">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Performance Report</span>
            <h1 className="text-lg font-semibold tracking-tight">{property.name}</h1>
          </div>
          <div className="ml-auto"><DateRangePicker /></div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">{children}</main>
      <footer className="border-t border-border py-4 text-center text-[11px] text-muted-foreground">
        Powered by Ridgeside Canine Dashboard
      </footer>
    </div>
  );
}